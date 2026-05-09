/**
 * Main solver entry point.
 *
 * Runs continuous beam-search over macro-actions per round. Instead of a hard
 * wall-clock deadline, callers pass a `shouldAbort()` callback (polled at loop
 * boundaries) and an `onProgress(plan)` callback that fires whenever a strictly
 * better plan is found. Yields to the host event loop between rounds so the
 * caller (typically a Web Worker) can process incoming messages promptly.
 */

import type {
  SolverState,
  SolverInput,
  SolverResult,
  Plan,
  RoundPlan,
  FrozenOpponent,
  ActionChoice,
  BoardExplorationToken,
  SolverDiceAssignment,
  SolverObjective,
  RecommendedMove,
  SolverAnalysisMode,
  MoveAlternative,
} from './types';
import type { GamePhase, KnowledgeToken, PredeterminedDiceSchedule, SolverFullPlayerState, SolverFullState } from '@khora/shared';
import type { PoliticsCard, ProgressTrackType } from '../types';
import { enumerateActionPlans, heuristicScore } from './action-enum';
import { enumerateProgressPlans } from './progress-enum';
import { applyTaxPhase, finalizeScore } from './scoring';
import { addMaskBit, cloneState, hasMaskBit, majorCount, popcount } from './card-data';
import { canSolveFromPhase, cardsForSolver } from './snapshot';
import { getAchievement } from './achievements';
import { capTaxGloryTrack } from './tracks';
import { applyThebesDev2Activation, canActivateThebesDev2 } from './city-data';
import type { PublicGameState } from '../types';
import { applyEventPhase } from './events';

// ─── Setup: build cardIds/allCards list and initial state ───────────────────

interface SolverContext {
  cardIds: string[];
  allCards: PoliticsCard[];
  opponents: FrozenOpponent[];
  shouldAbort: () => boolean;
  nodesExplored: { count: number };
  beamWidth: number;
  actionTopK: number;
  initialRound: number;    // the first round we were asked to plan for
  initialRoundTaxApplied: boolean;  // if true, skip tax at end of the first simulated round
  // Achievements still on the board at the snapshot. Projected future rounds
  // keep these tokens only until our line or opponent pressure claims them.
  availableAchievementIds: string[];
  // Achievement Tax/Glory picks already due to the player this round (the
  // server has decided which were claimed, only the choice remains). Set
  // when the snapshot is taken during the ACHIEVEMENT phase; 0 otherwise.
  pendingAchievementChoices: number;
  currentPhase: GamePhase;
  fullState: SolverFullState | null;
  objective: SolverObjective;
  playerId: string;
  predeterminedDice: PredeterminedDiceSchedule | null;
  diceRoll: number[] | null;
  unresolvedAssignedActions: SolverDiceAssignment[];
  opponentSearchCache: Map<string, number>;
  currentRoundActionTopK: number;
  opponentSearchEnabled: boolean;
  sharedPressureExemptPlayerIds?: ReadonlySet<string>;
}

const CURRENT_ROUND_ACTION_TOP_K = 999;
const FAST_CURRENT_ROUND_ACTION_TOP_K = 48;
const OPPONENT_BEAM_WIDTH = 240;

export function buildInitialState(input: SolverInput, cardIds: string[]): SolverState {
  const knowledge = {
    greenMinor: 0, blueMinor: 0, redMinor: 0,
    greenMajor: 0, blueMajor: 0, redMajor: 0,
  };
  for (const t of input.knowledgeTokens) {
    if (t.tokenType === 'MAJOR') {
      if (t.color === 'GREEN') knowledge.greenMajor++;
      else if (t.color === 'BLUE') knowledge.blueMajor++;
      else knowledge.redMajor++;
    } else {
      if (t.color === 'GREEN') knowledge.greenMinor++;
      else if (t.color === 'BLUE') knowledge.blueMinor++;
      else knowledge.redMinor++;
    }
  }

  let handMask = 0;
  let playedMask = 0;
  for (const c of input.handCards) {
    const idx = cardIds.indexOf(c.id);
    if (idx >= 0) handMask = addMaskBit(handMask, idx);
  }
  for (const c of input.playedCards) {
    const idx = cardIds.indexOf(c.id);
    if (idx >= 0) playedMask = addMaskBit(playedMask, idx);
  }
  const deckCardIndices = (input.fullState?.politicsDeck ?? [])
    .map(c => cardIds.indexOf(c.id))
    .filter((idx): idx is number => idx >= 0);

  return {
    round: input.currentRound,
    actionsAlreadyTaken: [...input.actionsAlreadyTaken],
    slotsConsumedThisRound: input.slotsConsumedThisRound,
    progressAlreadyDone: input.progressAlreadyDone,
    legislationDoneThisRound: input.legislationDoneThisRound,
    economyTrack: input.economyTrack,
    cultureTrack: input.cultureTrack,
    militaryTrack: input.militaryTrack,
    taxTrack: input.taxTrack,
    gloryTrack: input.gloryTrack,
    troopTrack: input.troopTrack,
    citizenTrack: input.citizenTrack,
    coins: input.coins,
    philosophyTokens: input.philosophyTokens,
    knowledge,
    cityId: input.cityId,
    developmentLevel: input.developmentLevel,
    handMask,
    playedMask,
    handSlots: input.handCards.length,
    deckCardIndices,
    boardTokens: input.boardTokens,
    availableAchievementIds: input.availableAchievementIds,
    victoryPoints: input.victoryPoints,
  };
}

// ─── Round simulation ────────────────────────────────────────────────────────

interface RoundResult {
  stateAfter: SolverState;
  chosenActions: ActionChoice[];
  progressTracks: ProgressTrackType[];
  philosophySpent: number;
  diceAssignments: SolverDiceAssignment[];
  dicePhilosophySpent: number;
  description: string[];
  vpBefore: number;
  vpAfter: number;
  coinsBefore: number;
  coinsAfter: number;
  achievementChoices: Array<'TAX' | 'GLORY'>;
}

/**
 * Simulate one round starting from state `s`. Returns top-K round outcomes
 * (for multi-round beam search). Results are sorted best-first by heuristic.
 */
function simulateRoundTopK(
  s: SolverState,
  ctx: SolverContext,
  topK: number,
): RoundResult[] {
  if (ctx.shouldAbort()) return [];

  const vpBefore = s.victoryPoints;
  const coinsBefore = s.coins;

  const maxSlots = s.cultureTrack >= 4 ? 3 : 2;
  const slotsLeft = Math.max(0, maxSlots - s.slotsConsumedThisRound);

  const scored: Array<{ score: number; result: RoundResult }> = [];

  // Tax-timing quirk: the real game applies tax at the START of each round
  // (TAXATION phase, before DICE). The solver applies tax at the END of each
  // simulated round — so for rounds 2..N the timing shifts by one round but
  // the per-round total is correct. For the INITIAL simulated round, we need
  // to know whether the real game has already applied tax for this round
  // (phase is TAXATION or later, so the coins in our snapshot include it) —
  // in that case we skip to avoid double-counting. When the snapshot is taken
  // during OMEN (before TAXATION), tax hasn't been applied and we DO apply it.
  const skipTax = s.round === ctx.initialRound && ctx.initialRoundTaxApplied;

  for (const start of thebesDev2Branches(s)) {
    const actionOptions = actionEnumerationOptions(start.state, ctx);
    const effectiveActionTopK = start.state.round === ctx.initialRound
      ? Math.max(ctx.actionTopK, ctx.currentRoundActionTopK)
      : ctx.actionTopK;
    const actionPlans = enumerateActionPlans(
      start.state,
      actionOptions.forcedAssignments ? actionOptions.forcedAssignments.length : slotsLeft,
      ctx.cardIds,
      ctx.allCards,
      ctx.opponents,
      effectiveActionTopK,
      actionOptions,
    );
    ctx.nodesExplored.count += actionPlans.length;

    for (const ap of actionPlans) {
      ctx.nodesExplored.count += 1;
      if (ctx.shouldAbort()) break;
      for (const afterAction of thebesDev2Branches(ap.state)) {
        const progressCandidates = enumerateProgressPlans(
          afterAction.state,
          ctx.opponents,
          (id) => hasCard(afterAction.state, id, ctx.cardIds),
          (id) => devUnlocked(afterAction.state, id),
        );
        ctx.nodesExplored.count += progressCandidates.length;

        for (const pState of progressCandidates) {
          for (const beforeEvent of thebesDev2Branches(pState)) {
            const eventCandidates = applyEventPhase(beforeEvent.state, ctx);
            ctx.nodesExplored.count += eventCandidates.length;
      // Achievement phase. Per spec, only the *initial* simulated round
      // attempts to claim — future rounds assume opponents have grabbed
      // whatever's still available. Two sub-cases on the initial round:
      //   - Pre-ACHIEVEMENT phase: predict which achievements we'll qualify
      //     for at end of round (`availableAchievementIds`).
      //   - During ACHIEVEMENT phase: claims already determined; only the
      //     +1 Tax / +1 Glory pick remains (`pendingAchievementChoices`).
      // Either way, branch over all (i Tax, N-i Glory) splits — the beam
      // picks whichever serves end-game scoring best.
            const startedWithProgressDone = afterAction.state.progressAlreadyDone;

            for (const ev of eventCandidates) {
              const postAchievementStates = applyAchievementPhase(
                ev.state,
                ev.state.availableAchievementIds,
                ev.state.round === ctx.initialRound ? ctx.pendingAchievementChoices : 0,
              );
              ctx.nodesExplored.count += postAchievementStates.length;

              for (const ach of postAchievementStates) {
                for (const afterAchievement of thebesDev2Branches(ach.state)) {
                  ctx.nodesExplored.count += 1;
                  const afterTax = cloneState(afterAchievement.state);
                  if (!skipTax) {
                    applyTaxPhase(afterTax, ctx.opponents, (id) => hasCard(afterTax, id, ctx.cardIds));
                  }
                  const score = rankState(afterTax, ctx);
                  const progressTracks = diffProgressTracks(afterAction.state, pState);
                  const philosophySpent = afterAction.state.philosophyTokens - pState.philosophyTokens;
                  const totalClaims = ach.claimedNames.length + ach.unnamedClaims;
                  const achievementDelta = totalClaims > 0
                    ? formatAchievementDelta(ach.claimedNames, ach.unnamedClaims, ach.taxAdd, ach.gloryAdd)
                    : null;
                  const thebesUses = start.uses + afterAction.uses + beforeEvent.uses + afterAchievement.uses;
                  scored.push({
                    score,
                    result: {
                      stateAfter: afterTax,
                      chosenActions: ap.choices,
                      progressTracks,
                      philosophySpent,
                      diceAssignments: ap.diceAssignments,
                      dicePhilosophySpent: ap.philosophyTokensToSpend,
                      description: describeRound(
                        ap.choices,
                        progressTracks,
                        philosophySpent,
                        ctx.cardIds,
                        ctx.allCards,
                        hasCard(pState, 'old-guard', ctx.cardIds),
                        ev.description,
                        ap.diceAssignments,
                        ap.citizenCost,
                        ap.philosophyTokensToSpend,
                        achievementDelta,
                        startedWithProgressDone,
                        thebesUses,
                      ),
                      vpBefore,
                      vpAfter: afterTax.victoryPoints,
                      coinsBefore,
                      coinsAfter: afterTax.coins,
                      achievementChoices: [
                        ...Array.from({ length: ach.taxAdd }, () => 'TAX' as const),
                        ...Array.from({ length: ach.gloryAdd }, () => 'GLORY' as const),
                      ],
                    },
                  });
                }
              }
            }
          }
        }
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(x => x.result);
}

function thebesDev2Branches(s: SolverState): Array<{ state: SolverState; uses: number }> {
  if (!canActivateThebesDev2(s, s.cityId, s.developmentLevel)) return [{ state: s, uses: 0 }];
  const out: Array<{ state: SolverState; uses: number }> = [];
  const seen = new Set<string>();
  for (const uses of thebesDev2UseCounts(s)) {
    const key = String(uses);
    if (seen.has(key)) continue;
    seen.add(key);
    if (uses === 0) {
      out.push({ state: s, uses: 0 });
      continue;
    }
    const variant = cloneState(s);
    applyThebesDev2Activation(variant, uses);
    out.push({ state: variant, uses });
  }
  return out;
}

function thebesDev2UseCounts(s: SolverState): number[] {
  const maxUses = Math.max(0, s.gloryTrack);
  if (maxUses <= 0) return [0];

  const counts: number[] = [0];

  // Include a small "fund this turn" branch so the solver can unlock a
  // development/progress/card line without enumerating every possible cash-out.
  if (s.coins < 8) {
    counts.push(Math.min(maxUses, Math.ceil((8 - s.coins) / 2)));
  }

  // If Glory is already worth at least the 4 VP cash-out, preserve most of it;
  // otherwise include the full cash-out branch. This keeps Thebes from
  // exploding combinatorially while retaining the important strategic choices.
  const majors = majorCount(s);
  counts.push(majors >= 4 ? Math.min(maxUses, Math.max(1, maxUses - 1)) : maxUses);

  return Array.from(new Set(counts))
    .filter(uses => uses >= 0 && uses <= maxUses)
    .sort((a, b) => a - b);
}

/**
 * Achievement-phase resolution (initial round only — see caller).
 *
 * Two sources of claims feed in:
 *   1. `availableAchievementIds` — achievements still on the board. The
 *      solver checks which the state qualifies for (named claims).
 *   2. `pendingChoices` — count of ACHIEVEMENT_TRACK_CHOICE decisions already
 *      pending for the player (server has determined the claim, only the
 *      Tax/Glory pick remains). These are "unnamed" from the solver's POV.
 *
 * For N total claims (named + unnamed) we emit N+1 branches: one per
 * (taxAdd, gloryAdd) split with taxAdd in 0..N. Each branch carries the
 * named-claim list + unnamed count + the Tax/Glory totals. The per-claim
 * choice collapses to N+1 outcomes (rather than 2^N) because the resulting
 * state depends only on the totals, not which specific claim got which pick.
 */
function applyAchievementPhase(
  s: SolverState,
  availableAchievementIds: string[],
  pendingChoices: number,
  clearUnclaimed: boolean = false,
): Array<{ state: SolverState; claimedNames: string[]; unnamedClaims: number; taxAdd: number; gloryAdd: number }> {
  const claimedNames: string[] = [];
  for (const id of availableAchievementIds) {
    const def = getAchievement(id);
    if (def && def.qualifies(s)) claimedNames.push(def.name);
  }
  const unnamedClaims = Math.max(0, pendingChoices);
  const total = claimedNames.length + unnamedClaims;
  if (total === 0) {
    if (!clearUnclaimed) return [{ state: s, claimedNames: [], unnamedClaims: 0, taxAdd: 0, gloryAdd: 0 }];
    const variant = cloneState(s);
    variant.availableAchievementIds = [];
    return [{ state: variant, claimedNames: [], unnamedClaims: 0, taxAdd: 0, gloryAdd: 0 }];
  }

  const branches: Array<{ state: SolverState; claimedNames: string[]; unnamedClaims: number; taxAdd: number; gloryAdd: number }> = [];
  for (let taxAdd = 0; taxAdd <= total; taxAdd++) {
    const gloryAdd = total - taxAdd;
    const variant = cloneState(s);
    variant.taxTrack = capTaxGloryTrack(variant.taxTrack + taxAdd);
    variant.gloryTrack = capTaxGloryTrack(variant.gloryTrack + gloryAdd);
    const claimed = new Set(claimedNames.map(name => achievementIdForName(name, availableAchievementIds)));
    variant.availableAchievementIds = clearUnclaimed
      ? []
      : variant.availableAchievementIds.filter(id => !claimed.has(id));
    branches.push({ state: variant, claimedNames, unnamedClaims, taxAdd, gloryAdd });
  }
  return branches;
}

function achievementIdForName(name: string, ids: string[]): string {
  for (const id of ids) {
    const def = getAchievement(id);
    if (def?.name === name) return id;
  }
  return name;
}

function formatAchievementDelta(
  names: string[],
  unnamedCount: number,
  taxAdd: number,
  gloryAdd: number,
): string {
  const parts: string[] = [];
  if (taxAdd > 0) parts.push(`${taxAdd} Tax reward${taxAdd === 1 ? '' : 's'}`);
  if (gloryAdd > 0) parts.push(`${gloryAdd} Glory reward${gloryAdd === 1 ? '' : 's'}`);
  const labels: string[] = [];
  if (names.length > 0) labels.push(names.join(', '));
  if (unnamedCount > 0) labels.push(`${unnamedCount} pending pick${unnamedCount === 1 ? '' : 's'}`);
  const labelText = labels.join(' + ') || 'claim';
  return parts.length > 0 ? `${labelText}: take ${parts.join(' and ')}` : labelText;
}

function hasCard(s: SolverState, id: string, cardIds: string[]): boolean {
  const idx = cardIds.indexOf(id);
  return idx >= 0 && hasMaskBit(s.playedMask, idx);
}

function devUnlocked(s: SolverState, id: string): boolean {
  // Simplified: if devId ends with "-dev-N" and s.developmentLevel >= N and s.cityId matches prefix
  const m = /^([a-z]+)-dev-(\d)$/.exec(id);
  if (!m) return false;
  const city = m[1];
  const n = parseInt(m[2], 10);
  return s.cityId === city && s.developmentLevel >= n;
}

function diffProgressTracks(before: SolverState, after: SolverState): ProgressTrackType[] {
  const diffs: ProgressTrackType[] = [];
  const e = after.economyTrack - before.economyTrack;
  const c = after.cultureTrack - before.cultureTrack;
  const m = after.militaryTrack - before.militaryTrack;
  for (let i = 0; i < e; i++) diffs.push('ECONOMY');
  for (let i = 0; i < c; i++) diffs.push('CULTURE');
  for (let i = 0; i < m; i++) diffs.push('MILITARY');
  return diffs;
}

function describeRound(
  choices: ActionChoice[],
  progressTracks: ProgressTrackType[],
  philosophySpent: number,
  cardIds: string[],
  allCards: PoliticsCard[],
  hasOldGuard: boolean,
  eventDelta: string | null,
  diceAssignments: SolverDiceAssignment[],
  citizenCost: number,
  dicePhilosophySpent: number,
  achievementDelta: string | null,
  startedWithProgressDone: boolean,
  thebesDev2Uses: number,
): string[] {
  const bullets: string[] = [];
  if (thebesDev2Uses > 0) {
    bullets.push(`Thebes dev 2 — spend ${thebesDev2Uses} Glory for ${2 * thebesDev2Uses} coins + ${4 * thebesDev2Uses} VP`);
  }
  if (diceAssignments.length > 0 && citizenCost > 0) {
    const parts = diceAssignments
      .filter(a => a.citizenCost > 0)
      .map(a => `${formatActionName(a.action)} with ${a.dieValue} (-${a.citizenCost})`);
    const scrolls = dicePhilosophySpent > 0
      ? `, spending ${dicePhilosophySpent} scroll${dicePhilosophySpent === 1 ? '' : 's'} first`
      : '';
    bullets.push(`Dice: spend ${citizenCost} citizens${scrolls} (${parts.join(', ')})`);
  }
  for (const c of choices) {
    bullets.push(describeChoice(c, cardIds, allCards));
  }
  // Progress bullet: omit entirely when the progress phase already resolved
  // before this snapshot was taken (the player has nothing to decide). When
  // we *do* have a progress decision to make, always emit a bullet — either
  // the chosen advances or an explicit skip.
  if (!startedWithProgressDone) {
    if (progressTracks.length > 0) {
      const counts = { ECONOMY: 0, CULTURE: 0, MILITARY: 0 };
      for (const t of progressTracks) counts[t]++;
      const parts: string[] = [];
      if (counts.ECONOMY) parts.push(formatProgressCount(counts.ECONOMY, 'Economy'));
      if (counts.CULTURE) parts.push(formatProgressCount(counts.CULTURE, 'Culture'));
      if (counts.MILITARY) parts.push(formatProgressCount(counts.MILITARY, 'Military'));
      let msg = `Progress: move up ${parts.join(', ')}`;
      if (philosophySpent > 0) msg += ` (spent ${philosophySpent} scrolls)`;
      bullets.push(msg);
    } else {
      bullets.push(hasOldGuard ? 'Progress: skip (Old Guard +4 VP)' : 'Progress: skip (nothing affordable)');
    }
  }
  if (eventDelta) {
    bullets.push(eventDelta);
  }
  if (achievementDelta) {
    bullets.push(`Achievement: ${achievementDelta}`);
  }
  return bullets;
}

function formatActionName(action: SolverDiceAssignment['action']): string {
  return action.charAt(0) + action.slice(1).toLowerCase();
}

function buildRecommendedMoves(
  r: RoundResult,
  cardIds: string[],
  allCards: PoliticsCard[],
): RecommendedMove[] {
  const moves: RecommendedMove[] = [];
  if (r.diceAssignments.length > 0) {
    moves.push({
      kind: 'ASSIGN_DICE',
      assignments: r.diceAssignments,
      philosophyTokensToSpend: r.dicePhilosophySpent > 0 ? r.dicePhilosophySpent : undefined,
    });
  }
  for (const choice of r.chosenActions) {
    moves.push({
      kind: 'RESOLVE_ACTION',
      actionType: choice.type,
      choice,
      choices: toActionChoices(choice, cardIds, allCards),
    });
  }
  if (r.progressTracks.length > 0 || r.philosophySpent > 0) {
    moves.push({ kind: 'PROGRESS_TRACK', tracks: r.progressTracks, philosophySpent: r.philosophySpent });
  }
  if (r.achievementChoices.length > 0) {
    moves.push({ kind: 'ACHIEVEMENT_TRACK_CHOICE', choices: r.achievementChoices });
  }
  return moves;
}

function toActionChoices(
  choice: ActionChoice,
  cardIds: string[],
  allCards: PoliticsCard[],
): import('@khora/shared').ActionChoices {
  switch (choice.type) {
    case 'TRADE':
      return choice.buyMinor
        ? { buyMinorKnowledge: true, minorKnowledgeColor: choice.buyMinor }
        : {};
    case 'MILITARY':
      return {
        explorationTokenId: choice.explore[0]?.id,
        secondExplorationTokenId: choice.explore[1]?.id,
      };
    case 'POLITICS': {
      const card = allCards[choice.cardIndex];
      return {
        targetCardId: card?.id ?? cardIds[choice.cardIndex],
        philosophyPairsToUse: choice.philosophyPairs || undefined,
        scholarlyWelcomeColor: choice.scholarlyWelcomeColor,
      };
    }
    case 'LEGISLATION': {
      const kept = choice.keepCardIndex !== undefined ? allCards[choice.keepCardIndex] : null;
      return kept ? { targetCardId: kept.id } : {};
    }
    case 'DEVELOPMENT':
      return {
        philosophyPairsToUse: choice.philosophyPairs || undefined,
        devTrackChoices: choice.miletusDev2Tracks ? [...choice.miletusDev2Tracks] : undefined,
        argosDevReward: choice.argosDev2Reward ? argosRewardToServer(choice.argosDev2Reward) : undefined,
      };
    default:
      return {};
  }
}

function argosRewardToServer(
  reward: NonNullable<Extract<ActionChoice, { type: 'DEVELOPMENT' }>['argosDev2Reward']>,
): 'troops' | 'coins' | 'vp' | 'citizens' {
  switch (reward) {
    case 'TROOPS': return 'troops';
    case 'COINS': return 'coins';
    case 'CITIZENS': return 'citizens';
    case 'VP': return 'vp';
  }
}

function actionEnumerationOptions(
  s: SolverState,
  ctx: SolverContext,
): {
  diceRoll?: number[] | null;
  forcedAssignments?: SolverDiceAssignment[];
  citizenCostsAlreadyPaid?: boolean;
} {
  if (s.round === ctx.initialRound && ctx.currentPhase === 'ACTIONS' && ctx.unresolvedAssignedActions.length > 0) {
    return {
      forcedAssignments: ctx.unresolvedAssignedActions,
      citizenCostsAlreadyPaid: true,
    };
  }
  if (s.round === ctx.initialRound && ctx.currentPhase === 'DICE' && ctx.diceRoll && ctx.diceRoll.length > 0) {
    return { diceRoll: ctx.diceRoll };
  }
  const scheduled = ctx.predeterminedDice?.[s.round]?.[ctx.playerId];
  if (scheduled && scheduled.length > 0) {
    const diceCount = s.cultureTrack >= 4 ? 3 : 2;
    return { diceRoll: scheduled.slice(0, diceCount) };
  }
  return {};
}

function describeChoice(
  c: ActionChoice,
  cardIds: string[],
  allCards: PoliticsCard[],
): string {
  switch (c.type) {
    case 'PHILOSOPHY': return 'Philosophy — gain 1 scroll';
    case 'CULTURE':    return 'Culture — gain VP';
    case 'TRADE':      return c.buyMinor
      ? `Trade — gain coins, buy a ${c.buyMinor} minor token`
      : 'Trade — gain coins';
    case 'MILITARY': {
      const describeToken = (t: { color: string; tokenType: string; militaryRequirement: number; skullCost: number; isPersepolis?: boolean }): string => {
        const color = t.color.charAt(0) + t.color.slice(1).toLowerCase();
        const type = t.tokenType.charAt(0) + t.tokenType.slice(1).toLowerCase();
        const persepolis = t.isPersepolis ? ' Persepolis' : '';
        return `${color} ${type}${persepolis} (${t.militaryRequirement}-${t.skullCost})`;
      };
      const list = c.explore.map(describeToken).join(', ');
      return `Military — gain troops${c.explore.length ? `, explore ${list}` : ''}`;
    }
    case 'POLITICS': {
      const card = allCards[c.cardIndex];
      const name = card?.name ?? cardIds[c.cardIndex] ?? '?';
      return `Politics — play "${name}"${c.philosophyPairs ? ` (+${c.philosophyPairs * 2} scrolls)` : ''}`;
    }
    case 'DEVELOPMENT': {
      const choices: string[] = [];
      if (c.miletusDev2Tracks) {
        choices.push(`level up ${formatTrackName(c.miletusDev2Tracks[0])} and ${formatTrackName(c.miletusDev2Tracks[1])}`);
      }
      if (c.spartaDev3Colors) {
        choices.push(`take ${formatColor(c.spartaDev3Colors[0])} and ${formatColor(c.spartaDev3Colors[1])} minor tokens`);
      }
      if (c.argosDev2Reward) {
        choices.push(`take ${formatArgosReward(c.argosDev2Reward)}`);
      }
      const choiceText = choices.length > 0 ? ` (${choices.join('; ')})` : '';
      return `Development — unlock next level${c.philosophyPairs ? ` (+${c.philosophyPairs * 2} scrolls)` : ''}${choiceText}`;
    }
    case 'LEGISLATION': {
      const kept = c.keepCardIndex !== undefined ? allCards[c.keepCardIndex] : null;
      return kept ? `Legislation — keep ${kept.name}` : 'Legislation — +3 citizens';
    }
  }
}

function formatTrackName(track: ProgressTrackType): string {
  return track.charAt(0) + track.slice(1).toLowerCase();
}

function formatProgressCount(count: number, track: string): string {
  return count === 1 ? track : `${count} ${track}`;
}

function formatColor(color: string): string {
  return color.charAt(0) + color.slice(1).toLowerCase();
}

function formatArgosReward(reward: NonNullable<Extract<ActionChoice, { type: 'DEVELOPMENT' }>['argosDev2Reward']>): string {
  switch (reward) {
    case 'TROOPS': return '+2 troops';
    case 'COINS': return '+3 coins';
    case 'CITIZENS': return '+5 citizens';
    case 'VP': return '+4 VP';
  }
}

/** Transition state to next round: reset mid-round flags, increment round. */
function advanceToNextRound(s: SolverState): SolverState {
  const next = cloneState(s);
  next.round += 1;
  next.actionsAlreadyTaken = [];
  next.slotsConsumedThisRound = 0;
  next.progressAlreadyDone = false;
  next.legislationDoneThisRound = false;
  return next;
}

// ─── Diversity-preserving beam selection ────────────────────────────────────

/**
 * Select up to `beamWidth` entries from a sorted list while preserving
 * strategic diversity. Bucketing by (developmentLevel, cultureTrack>=4 flag,
 * majorsTier) prevents the beam from collapsing into a single near-identical
 * trajectory (e.g. 12 Old-Guard-spam variants) and keeps Dev-investment paths
 * alive even when their current score lags.
 */
function diversifyBeam<T extends { state: SolverState }>(
  sortedDesc: T[],
  beamWidth: number,
): T[] {
  if (sortedDesc.length <= beamWidth) return sortedDesc;

  const majorsTier = (s: SolverState): number => {
    const m = s.knowledge.greenMajor + s.knowledge.blueMajor + s.knowledge.redMajor;
    if (m >= 4) return 4;
    if (m >= 3) return 3;
    if (m >= 2) return 2;
    if (m >= 1) return 1;
    return 0;
  };
  const bucketKey = (s: SolverState): string => {
    const devCap = Math.min(s.developmentLevel, 4);
    const cult4 = s.cultureTrack >= 4 ? 1 : 0;
    const mil4 = s.militaryTrack >= 4 ? 1 : 0;
    const mt = majorsTier(s);
    const playedT = Math.min(popcount(s.playedMask), 8);
    const taxBin = Math.min(s.taxTrack, 6);
    const coinBin = s.coins >= 12 ? 2 : s.coins >= 6 ? 1 : 0;
    const scrollBin = s.philosophyTokens >= 4 ? 2 : s.philosophyTokens >= 2 ? 1 : 0;
    return `${devCap}-${cult4}-${mil4}-${mt}-${playedT}-${taxBin}-${coinBin}-${scrollBin}`;
  };

  const exactKey = (s: SolverState): string =>
    `${s.handMask}|${s.playedMask}|${s.handSlots}|${s.victoryPoints}|${s.coins}|${s.philosophyTokens}|` +
    `${s.economyTrack}|${s.cultureTrack}|${s.militaryTrack}|${s.taxTrack}|${s.gloryTrack}|` +
    `${s.troopTrack}|${s.citizenTrack}|${s.developmentLevel}|` +
    `${s.knowledge.greenMinor},${s.knowledge.blueMinor},${s.knowledge.redMinor},` +
    `${s.knowledge.greenMajor},${s.knowledge.blueMajor},${s.knowledge.redMajor}|` +
    `${s.round}|${s.actionsAlreadyTaken.join(',')}|${s.progressAlreadyDone ? 1 : 0}|` +
    `${s.legislationDoneThisRound ? 1 : 0}|${s.boardTokens.map(t => t.id).join(',')}|` +
    `${s.deckCardIndices.slice(0, 8).join(',')}|` +
    `${s.availableAchievementIds.join(',')}`;

  const seenExact = new Set<string>();
  const deduped: T[] = [];
  for (const entry of sortedDesc) {
    const k = exactKey(entry.state);
    if (seenExact.has(k)) continue;
    seenExact.add(k);
    deduped.push(entry);
  }

  const seenBuckets = new Set<string>();
  const chosen: T[] = [];
  for (const entry of deduped) {
    if (chosen.length >= beamWidth) break;
    const key = bucketKey(entry.state);
    if (seenBuckets.has(key)) continue;
    seenBuckets.add(key);
    chosen.push(entry);
  }
  if (chosen.length < beamWidth) {
    const chosenSet = new Set(chosen);
    for (const entry of deduped) {
      if (chosen.length >= beamWidth) break;
      if (chosenSet.has(entry)) continue;
      chosen.push(entry);
    }
  }
  return chosen;
}

function rankState(s: SolverState, ctx: SolverContext): number {
  const ownScore = heuristicScore(s, ctx.cardIds);
  if (ctx.objective !== 'WIN_MARGIN') return ownScore;
  return ownScore - estimateStrongestOpponentVP(s, ctx, false);
}

function finalObjectiveScore(
  s: SolverState,
  ctx: SolverContext,
  cardIds: string[],
  allCards: PoliticsCard[],
): number {
  const ownVP = finalizeScore(s, cardIds, allCards).total;
  if (ctx.objective !== 'WIN_MARGIN') return ownVP;
  return ownVP - estimateStrongestOpponentVP(s, ctx, ctx.opponentSearchEnabled);
}

function estimateStrongestOpponentVP(s: SolverState, ctx: SolverContext, allowSearch: boolean): number {
  if (!ctx.fullState) return 0;
  let strongest = 0;
  for (const p of ctx.fullState.players) {
    if (p.playerId === ctx.playerId || !p.isConnected) continue;
    strongest = Math.max(strongest, allowSearch
      ? estimateOpponentBestReachableVP(p, s, ctx)
      : estimateOpponentVP(p, s.boardTokens, ctx, s.availableAchievementIds, s.round));
  }
  return strongest;
}

function estimateOpponentBestReachableVP(
  p: SolverFullPlayerState,
  ourLineState: SolverState,
  ctx: SolverContext,
): number {
  const tokenKey = ourLineState.boardTokens.map(t => t.id).join(',');
  const achievementKey = ourLineState.availableAchievementIds.join(',');
  const deckKey = ourLineState.deckCardIndices
    .slice(0, 8)
    .map(index => ctx.cardIds[index] ?? index)
    .join(',');
  const cacheKey = `${p.playerId}|${ctx.initialRound}|${ourLineState.round}|${tokenKey}|${achievementKey}|${deckKey}`;
  const cached = ctx.opponentSearchCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const searched = runOpponentBeamSearch(p, ourLineState, ctx);
  const fallback = estimateOpponentVP(p, ourLineState.boardTokens, ctx, ourLineState.availableAchievementIds, ourLineState.round);
  const best = Math.max(searched ?? -Infinity, fallback);
  ctx.opponentSearchCache.set(cacheKey, best);
  return best;
}

function runOpponentBeamSearch(
  p: SolverFullPlayerState,
  ourLineState: SolverState,
  parentCtx: SolverContext,
): number | null {
  if (!parentCtx.fullState || parentCtx.shouldAbort()) return null;
  const remainingDeckCards = remainingDeckForOpponent(ourLineState, parentCtx);
  const allCards = uniqueCards([...p.handCards, ...p.playedCards, ...remainingDeckCards]);
  const cardIds = allCards.map(c => c.id);
  const state = opponentInitialState(p, ourLineState, parentCtx.initialRound, cardIds, remainingDeckCards);
  const opponentCtx: SolverContext = {
    ...parentCtx,
    cardIds,
    allCards,
    opponents: parentCtx.fullState.players
      .filter(o => o.playerId !== p.playerId && o.isConnected)
      .map(o => ({
        playerId: o.playerId,
        economyTrack: o.economyTrack,
        cultureTrack: o.cultureTrack,
        militaryTrack: o.militaryTrack,
        coins: o.coins,
        philosophyTokens: o.philosophyTokens,
        knowledgeTokens: o.knowledgeTokens,
        handCards: o.handCards,
        playedCards: o.playedCards,
        actionSlots: o.actionSlots,
      })),
    objective: 'MAX_VP',
    playerId: p.playerId,
    initialRound: parentCtx.initialRound,
    currentPhase: 'OMEN',
    pendingAchievementChoices: 0,
    diceRoll: null,
    unresolvedAssignedActions: [],
    opponentSearchCache: parentCtx.opponentSearchCache,
    currentRoundActionTopK: parentCtx.currentRoundActionTopK,
    opponentSearchEnabled: false,
    sharedPressureExemptPlayerIds: new Set([parentCtx.playerId]),
  };

  let beam: Array<{ state: SolverState }> = [{ state }];
  const beamWidth = OPPONENT_BEAM_WIDTH;
  for (let round = state.round; round <= 9; round++) {
    if (parentCtx.shouldAbort()) return null;
    const next: Array<{ state: SolverState }> = [];
    for (const entry of beam) {
      const results = simulateRoundTopK({ ...entry.state, round }, opponentCtx, beamWidth);
      for (const r of results) {
        const nextState = advanceToNextRound(r.stateAfter);
        applySharedOpponentPressure(nextState, opponentCtx, round);
        next.push({ state: nextState });
      }
    }
    if (next.length === 0) break;
    next.sort((a, b) => heuristicScore(b.state, cardIds) - heuristicScore(a.state, cardIds));
    beam = diversifyBeam(next, beamWidth);
  }

  let best = -Infinity;
  for (const entry of beam) {
    best = Math.max(best, finalizeScore(entry.state, cardIds, allCards).total);
  }
  return Number.isFinite(best) ? best : null;
}

function uniqueCards(cards: PoliticsCard[]): PoliticsCard[] {
  const seen = new Set<string>();
  const out: PoliticsCard[] = [];
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    out.push(card);
  }
  return out;
}

function opponentInitialState(
  p: SolverFullPlayerState,
  ourLineState: SolverState,
  startRound: number,
  cardIds: string[],
  remainingDeckCards: PoliticsCard[],
): SolverState {
  let handMask = 0;
  let playedMask = 0;
  for (const c of p.handCards) {
    const idx = cardIds.indexOf(c.id);
    if (idx >= 0) handMask = addMaskBit(handMask, idx);
  }
  for (const c of p.playedCards) {
    const idx = cardIds.indexOf(c.id);
    if (idx >= 0) playedMask = addMaskBit(playedMask, idx);
  }
  return {
    round: startRound,
    actionsAlreadyTaken: [],
    slotsConsumedThisRound: 0,
    progressAlreadyDone: false,
    legislationDoneThisRound: false,
    economyTrack: p.economyTrack,
    cultureTrack: p.cultureTrack,
    militaryTrack: p.militaryTrack,
    taxTrack: p.taxTrack,
    gloryTrack: p.gloryTrack,
    troopTrack: p.troopTrack,
    citizenTrack: p.citizenTrack,
    coins: p.coins,
    philosophyTokens: p.philosophyTokens,
    knowledge: knowledgeFromTokens(p.knowledgeTokens),
    cityId: p.cityId,
    developmentLevel: p.developmentLevel,
    handMask,
    playedMask,
    handSlots: p.handCards.length,
    deckCardIndices: remainingDeckCards
      .map(card => cardIds.indexOf(card.id))
      .filter((index): index is number => index >= 0),
    boardTokens: ourLineState.boardTokens,
    availableAchievementIds: ourLineState.availableAchievementIds,
    victoryPoints: p.victoryPoints,
  };
}

function remainingDeckForOpponent(
  ourLineState: SolverState,
  ctx: SolverContext,
): PoliticsCard[] {
  if (!ctx.fullState || ourLineState.deckCardIndices.length === 0) return [];
  const remainingIds = new Set(
    ourLineState.deckCardIndices
      .map(index => ctx.cardIds[index])
      .filter((id): id is string => Boolean(id)),
  );
  return ctx.fullState.politicsDeck.filter(card => remainingIds.has(card.id));
}

function estimateOpponentVP(
  p: SolverFullPlayerState,
  remainingBoardTokens: BoardExplorationToken[],
  ctx: SolverContext,
  availableAchievementIds: string[],
  lineRound: number,
): number {
  const currentRound = Math.max(ctx.initialRound, Math.min(10, lineRound));
  const cardIds = p.playedCards.map(c => c.id);
  let playedMask = 0;
  for (let i = 0; i < cardIds.length; i++) playedMask = addMaskBit(playedMask, i);
  const state: SolverState = {
    round: currentRound,
    actionsAlreadyTaken: [],
    slotsConsumedThisRound: 0,
    progressAlreadyDone: false,
    legislationDoneThisRound: false,
    economyTrack: p.economyTrack,
    cultureTrack: p.cultureTrack,
    militaryTrack: p.militaryTrack,
    taxTrack: p.taxTrack,
    gloryTrack: p.gloryTrack,
    troopTrack: p.troopTrack,
    citizenTrack: p.citizenTrack,
    coins: p.coins,
    philosophyTokens: p.philosophyTokens,
    knowledge: knowledgeFromTokens(p.knowledgeTokens),
    cityId: p.cityId,
    developmentLevel: p.developmentLevel,
    handMask: 0,
    playedMask,
    handSlots: p.handCards.length,
    deckCardIndices: [],
    boardTokens: remainingBoardTokens,
    availableAchievementIds: [],
    victoryPoints: p.victoryPoints,
  };
  const currentFinal = finalizeScore(state, cardIds, p.playedCards).total;
  const roundsLeft = Math.max(0, 10 - currentRound);
  const tempo = roundsLeft * (
    2.5 +
    p.economyTrack * 0.9 +
    p.cultureTrack * 1.1 +
    p.militaryTrack * 1.1 +
    p.taxTrack * 0.7 +
    p.gloryTrack * 0.4
  );
  const handPotential = Math.min(p.handCards.length, roundsLeft) * 2.5;
  const boardPotential = estimateOpponentBoardPotential(p, remainingBoardTokens, roundsLeft);
  const achievementPotential = estimateOpponentAchievementPotential(
    p,
    state,
    ctx,
    availableAchievementIds,
    roundsLeft,
    Math.max(0, currentRound - ctx.initialRound),
  );
  return currentFinal + tempo + handPotential + boardPotential + achievementPotential;
}

function estimateOpponentAchievementPotential(
  p: SolverFullPlayerState,
  state: SolverState,
  ctx: SolverContext,
  availableAchievementIds: string[],
  roundsLeft: number,
  projectedRoundsElapsed: number,
): number {
  const pendingChoices = ctx.fullState?.pendingDecisions
    .filter(d => d.playerId === p.playerId && d.decisionType === 'ACHIEVEMENT_TRACK_CHOICE')
    .length ?? 0;
  let claimCount = pendingChoices;

  const stillAvailable = new Set(availableAchievementIds);
  if (ctx.currentPhase !== 'ACHIEVEMENT') {
    for (const id of availableAchievementIds) {
      const def = getAchievement(id);
      if (def?.qualifies(state)) claimCount += 1;
    }
  }
  for (const id of ctx.availableAchievementIds) {
    if (stillAvailable.has(id)) continue;
    if (opponentLikelyClaimsAchievement(p, id, Math.max(1, projectedRoundsElapsed))) claimCount += 1;
  }

  if (claimCount <= 0) return 0;
  const futureTaxValue = Math.max(1, Math.max(0, roundsLeft - 1) * 0.75);
  const gloryValue = Math.max(1, majorCount(state));
  return claimCount * Math.max(2, futureTaxValue, gloryValue);
}

function knowledgeFromTokens(tokens: KnowledgeToken[]): SolverState['knowledge'] {
  const knowledge = {
    greenMinor: 0, blueMinor: 0, redMinor: 0,
    greenMajor: 0, blueMajor: 0, redMajor: 0,
  };
  for (const t of tokens) {
    if (t.tokenType === 'MAJOR') {
      if (t.color === 'GREEN') knowledge.greenMajor++;
      else if (t.color === 'BLUE') knowledge.blueMajor++;
      else knowledge.redMajor++;
    } else {
      if (t.color === 'GREEN') knowledge.greenMinor++;
      else if (t.color === 'BLUE') knowledge.blueMinor++;
      else knowledge.redMinor++;
    }
  }
  return knowledge;
}

function estimateOpponentBoardPotential(
  p: SolverFullPlayerState,
  remainingBoardTokens: BoardExplorationToken[],
  roundsLeft: number,
): number {
  if (roundsLeft <= 0 || remainingBoardTokens.length === 0) return 0;
  const potentialTroops = Math.min(15, p.troopTrack + p.militaryTrack * roundsLeft);
  const values = remainingBoardTokens
    .filter(t => t.militaryRequirement <= potentialTroops)
    .map(t => {
      const majorValue = t.isPersepolis ? p.gloryTrack * 3 + 8 : t.tokenType === 'MAJOR' ? p.gloryTrack + 2 : 1;
      return t.bonusVP + t.bonusCoins * 0.5 + majorValue - Math.max(0, t.skullCost) * 0.2;
    })
    .sort((a, b) => b - a);
  return values.slice(0, Math.min(roundsLeft, 4)).reduce((sum, v) => sum + Math.max(0, v), 0);
}

function applySharedOpponentPressure(
  s: SolverState,
  ctx: SolverContext,
  completedRound: number,
): void {
  if (!ctx.fullState) return;
  removeOpponentClaimedAchievements(s, ctx, completedRound);
  removeOpponentBoardTokens(s, ctx, completedRound);
  applyOpponentDeckPressure(s, ctx, completedRound);
}

function sharedPressurePlayers(ctx: SolverContext): SolverFullPlayerState[] {
  if (!ctx.fullState) return [];
  return ctx.fullState.players.filter(p =>
    p.playerId !== ctx.playerId
    && !ctx.sharedPressureExemptPlayerIds?.has(p.playerId)
    && p.isConnected
    && !p.hasFlagged,
  );
}

function projectedRoundCount(ctx: SolverContext, completedRound: number): number {
  return Math.max(0, completedRound - ctx.initialRound + 1);
}

function removeOpponentClaimedAchievements(
  s: SolverState,
  ctx: SolverContext,
  completedRound: number,
): void {
  if (s.availableAchievementIds.length === 0) return;
  const rounds = projectedRoundCount(ctx, completedRound);
  if (rounds <= 0) return;
  const opponents = sharedPressurePlayers(ctx);
  if (opponents.length === 0) return;

  s.availableAchievementIds = s.availableAchievementIds.filter(id =>
    !opponents.some(p => opponentLikelyClaimsAchievement(p, id, rounds)),
  );
}

function opponentLikelyClaimsAchievement(
  p: SolverFullPlayerState,
  achievementId: string,
  projectedRounds: number,
): boolean {
  const playedCount = p.playedCards.length;
  switch (achievementId) {
    case 'ach-10vp': {
      const cultureRate = Math.max(1, p.cultureTrack);
      const taxRate = Math.max(0, p.taxTrack - 1) * 0.75;
      return p.victoryPoints + projectedRounds * (cultureRate + taxRate + 1) >= 10;
    }
    case 'ach-12citizens':
      return p.citizenTrack + projectedRounds * 3 >= 12;
    case 'ach-4economy':
      return p.economyTrack + Math.ceil(projectedRounds / 2) >= 4;
    case 'ach-3cards': {
      const likelyNewCards = Math.min(
        projectedRounds,
        p.handCards.length + Math.max(0, Math.floor(projectedRounds / 2)),
      );
      return playedCount + likelyNewCards >= 3;
    }
    case 'ach-6troops':
      return p.troopTrack + projectedRounds * Math.max(1, p.militaryTrack) >= 6;
    default:
      return false;
  }
}

function removeOpponentBoardTokens(
  s: SolverState,
  ctx: SolverContext,
  completedRound: number,
): void {
  if (s.boardTokens.length === 0) return;
  const opponents = sharedPressurePlayers(ctx);
  if (opponents.length === 0) return;
  const roundOffset = projectedRoundCount(ctx, completedRound);
  if (roundOffset <= 0) return;

  let remaining = s.boardTokens;
  const removed = new Set<string>();
  for (const p of opponents) {
    const claims = opponentBoardClaimsThisRound(p, remaining, roundOffset);
    for (const token of claims) removed.add(token.id);
    if (claims.length > 0) {
      const claimed = new Set(claims.map(token => token.id));
      remaining = remaining.filter(token => !claimed.has(token.id));
    }
  }
  if (removed.size === 0) return;
  s.boardTokens = remaining;
}

function opponentBoardClaimsThisRound(
  p: SolverFullPlayerState,
  tokens: BoardExplorationToken[],
  roundOffset: number,
): BoardExplorationToken[] {
  const projectedTroops = Math.min(15, p.troopTrack + p.militaryTrack * roundOffset);
  const affordable = tokens
    .filter(token => token.militaryRequirement <= projectedTroops)
    .map(token => ({ token, score: opponentTokenRaceValue(token, p) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  if (affordable.length === 0) return [];

  const likelyMilitaryTempo = p.militaryTrack >= 4 || p.troopTrack >= 6 || roundOffset % 2 === 1;
  if (!likelyMilitaryTempo) return [];
  const maxClaims = p.cityId === 'thebes' && p.developmentLevel >= 3 ? 2 : 1;
  return affordable.slice(0, maxClaims).map(entry => entry.token);
}

function opponentTokenRaceValue(token: BoardExplorationToken, p: SolverFullPlayerState): number {
  const knowledgeValue = token.isPersepolis
    ? 10 + p.gloryTrack * 3
    : token.tokenType === 'MAJOR'
      ? 4 + p.gloryTrack
      : 1.5;
  return token.bonusVP + token.bonusCoins * 0.45 + knowledgeValue - Math.max(0, token.skullCost) * 0.35;
}

function applyOpponentDeckPressure(
  s: SolverState,
  ctx: SolverContext,
  completedRound: number,
): void {
  if (s.deckCardIndices.length === 0) return;
  const opponents = sharedPressurePlayers(ctx);
  if (opponents.length === 0) return;
  const roundOffset = projectedRoundCount(ctx, completedRound);
  if (roundOffset <= 0) return;

  for (const p of opponents) {
    const draws = opponentLegislationDrawsThisRound(p, roundOffset);
    for (let i = 0; i < draws && s.deckCardIndices.length > 0; i += 1) {
      const drawn = s.deckCardIndices.slice(0, 2);
      const keepIndex = bestOpponentDeckKeep(drawn, p, ctx.allCards);
      if (keepIndex === null) break;
      const unchosen = drawn.filter(index => index !== keepIndex);
      s.deckCardIndices = [...s.deckCardIndices.slice(drawn.length), ...unchosen];
    }
  }
}

function opponentLegislationDrawsThisRound(
  p: SolverFullPlayerState,
  roundOffset: number,
): number {
  if (p.handCards.length <= 1 && roundOffset <= 2) return 1;
  if (p.handCards.length <= 2 && roundOffset === 1 && p.cultureTrack >= 3) return 1;
  if (roundOffset >= 3 && roundOffset % 3 === 0) return 1;
  return 0;
}

function bestOpponentDeckKeep(
  drawn: number[],
  p: SolverFullPlayerState,
  allCards: PoliticsCard[],
): number | null {
  let bestIndex: number | null = null;
  let bestScore = -Infinity;
  for (const index of drawn) {
    const card = allCards[index];
    if (!card) continue;
    const score = opponentCardRaceValue(card, p);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function opponentCardRaceValue(card: PoliticsCard, p: SolverFullPlayerState): number {
  const marquee: Record<string, number> = {
    'central-government': 40,
    diversification: 36,
    'gold-reserve': 34,
    'hall-of-statues': 32,
    'public-market': 30,
    taxation: 28,
    'corinthian-columns': 26,
    'greek-fire': 24,
    council: 23,
    gradualism: 22,
    'old-guard': 20,
    'constructing-the-mint': 20,
    'scholarly-welcome': 18,
  };
  const typeValue = card.type === 'END_GAME' ? 18 : card.type === 'ONGOING' ? 14 : 10;
  const affordability = p.coins >= card.cost ? 4 : -Math.max(0, card.cost - p.coins) * 0.8;
  const trackFit =
    (card.id === 'diversification' ? Math.min(p.economyTrack, p.cultureTrack, p.militaryTrack) * 2 : 0)
    + (card.id === 'gold-reserve' ? p.economyTrack * 1.5 : 0)
    + (card.id === 'heavy-taxes' ? p.taxTrack * 1.5 : 0)
    + (card.id === 'proskenion' ? p.citizenTrack * 0.9 : 0)
    + (card.id === 'hall-of-statues' ? p.knowledgeTokens.length * 0.8 : 0);
  return (marquee[card.id] ?? 0) + typeValue + affordability + trackFit;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export interface RunSolverOptions {
  /** Polled at loop boundaries; returning true stops the search asap. */
  shouldAbort: () => boolean;
  /** Fired whenever a strictly better plan is found. */
  onProgress?: (plan: Plan) => void;
  /**
   * Awaited between rounds so the host event loop can process messages
   * (critical inside a Web Worker). Default: `() => Promise.resolve()`.
   */
  yieldToHost?: () => Promise<void>;
}

/**
 * Continuous optimal-play search. Runs until `shouldAbort()` returns true.
 * Streams improvements via `onProgress`. Also returns the best plan found.
 */
export async function runSolver(
  input: SolverInput,
  publicState: PublicGameState,
  options: RunSolverOptions,
): Promise<SolverResult> {
  const phaseCheck = canSolveFromPhase(publicState);
  if (!phaseCheck.ok) {
    return { ok: false, reason: phaseCheck.reason!, message: phaseCheck.message ?? 'Unavailable' };
  }

  const { shouldAbort, onProgress, yieldToHost = () => Promise.resolve() } = options;
  const start = Date.now();

  const allCardObjs = cardsForSolver(input);
  const cardIds = allCardObjs.map(c => c.id);

  const initialState = buildInitialState(input, cardIds);

  interface BeamEntry {
    state: SolverState;
    roundPlans: RoundPlan[];
  }

  interface ScoredBeamEntry extends BeamEntry {
    objectiveScore: number;
  }

  const nodesExploredShared = { count: 0 };
  const opponentSearchCacheShared = new Map<string, number>();

  const makeContext = (
    beamWidth: number,
    actionTopK: number,
    currentRoundActionTopK = CURRENT_ROUND_ACTION_TOP_K,
    opponentSearchEnabled = false,
  ): SolverContext => ({
    cardIds,
    allCards: allCardObjs,
    opponents: input.opponents,
    shouldAbort,
    nodesExplored: nodesExploredShared,
    beamWidth,
    actionTopK,
    initialRound: initialState.round,
    initialRoundTaxApplied: input.initialRoundTaxApplied,
    availableAchievementIds: input.availableAchievementIds,
    pendingAchievementChoices: input.pendingAchievementChoices,
    currentPhase: input.currentPhase,
    fullState: input.fullState,
    objective: input.objective,
    playerId: input.playerId,
    predeterminedDice: input.predeterminedDice,
    diceRoll: input.diceRoll,
    unresolvedAssignedActions: input.unresolvedAssignedActions,
    opponentSearchCache: opponentSearchCacheShared,
    currentRoundActionTopK,
    opponentSearchEnabled,
    sharedPressureExemptPlayerIds: new Set(),
  });

  /** Run a full 9-round beam search with the given widths. Returns best trajectory or null if aborted. */
  const runBeam = async (
    beamWidth: number,
    actionTopK: number,
    _pass: number = 0,
    currentRoundActionTopK = CURRENT_ROUND_ACTION_TOP_K,
    opponentSearchEnabled = false,
  ): Promise<{ best: BeamEntry; alternatives: MoveAlternative[] } | null> => {
    const ctx = makeContext(beamWidth, actionTopK, currentRoundActionTopK, opponentSearchEnabled);

    let beam: BeamEntry[] = [{ state: initialState, roundPlans: [] }];

    for (let round = initialState.round; round <= 9; round++) {
      if (shouldAbort()) return null;
      const nextBeam: BeamEntry[] = [];
      for (const entry of beam) {
        if (shouldAbort()) return null;
        const stateAtRound = { ...entry.state, round };
        const results = simulateRoundTopK(stateAtRound, ctx, beamWidth);
        for (const r of results) {
          const nextState = advanceToNextRound(r.stateAfter);
          applySharedOpponentPressure(nextState, ctx, round);
          nextBeam.push({
            state: nextState,
            roundPlans: [
              ...entry.roundPlans,
              {
                round,
                description: r.description,
                actionTypes: r.chosenActions.map(c => c.type),
                recommendedMoves: buildRecommendedMoves(r, ctx.cardIds, ctx.allCards),
                vpBefore: r.vpBefore,
                vpAfter: r.vpAfter,
                coinsBefore: r.coinsBefore,
                coinsAfter: r.coinsAfter,
              },
            ],
          });
        }
      }
      if (nextBeam.length === 0) return null;
      nextBeam.sort((a, b) =>
        rankState(b.state, ctx) - rankState(a.state, ctx)
      );
      beam = diversifyBeam(nextBeam, beamWidth);
      if (round === initialState.round && onProgress && beam[0]) {
        onProgress(buildPlan(beam[0], cardIds, allCardObjs, nodesExploredShared, start, ctx, [], true));
      }
      // Yield to host event loop between rounds so pending worker messages
      // (abort/restart) get processed without waiting for the full pass.
      await yieldToHost();
    }

    const scoredEntries: ScoredBeamEntry[] = [];
    for (const entry of beam) {
      const sc = finalObjectiveScore(entry.state, ctx, cardIds, allCardObjs);
      scoredEntries.push({ ...entry, objectiveScore: sc });
    }
    const best = selectRobustBestEntry(scoredEntries, ctx);
    if (!best) return null;
    return { best, alternatives: buildMoveAlternatives(scoredEntries, ctx, cardIds, allCardObjs) };
  };

  let overallBest: BeamEntry | null = null;
  let overallBestCtx: SolverContext | null = null;
  let overallBestAlternatives: MoveAlternative[] = [];
  let bestHeuristicScore = -Infinity;
  let bestHeuristicModeRank = -1;
  let bestAdversarialScore = -Infinity;
  let hasAdversarialResult = false;

  const reportIfBetter = (
    result: { best: BeamEntry; alternatives: MoveAlternative[] },
    opponentSearchEnabled: boolean,
    beamWidth: number,
    actionTopK: number,
    currentRoundActionTopK = CURRENT_ROUND_ACTION_TOP_K,
  ): void => {
    const ctx = makeContext(beamWidth, actionTopK, currentRoundActionTopK, opponentSearchEnabled);
    const objectiveScore = finalObjectiveScore(result.best.state, ctx, cardIds, allCardObjs);
    const isAdversarial = input.objective === 'WIN_MARGIN' && opponentSearchEnabled;
    if (isAdversarial) {
      if (hasAdversarialResult && objectiveScore <= bestAdversarialScore) return;
      hasAdversarialResult = true;
      bestAdversarialScore = objectiveScore;
    } else {
      const modeRank = analysisModeRank(ctx);
      if (objectiveScore < bestHeuristicScore) return;
      if (objectiveScore === bestHeuristicScore && modeRank <= bestHeuristicModeRank) return;
      bestHeuristicScore = objectiveScore;
      bestHeuristicModeRank = modeRank;
      if (hasAdversarialResult) return;
    }
    overallBest = result.best;
    overallBestCtx = ctx;
    overallBestAlternatives = result.alternatives;
    if (onProgress) onProgress(buildPlan(result.best, cardIds, allCardObjs, nodesExploredShared, start, ctx, result.alternatives));
  };

  // Phase 1: iterative deepening — start narrow (fast first result) and widen
  // progressively until the profile saturates or we're aborted.
  const baseWidths: Array<[number, number, number]> = [
    [8, 8, 8],
    [12, 12, 16],
    [24, 16, 24],
    [48, 20, FAST_CURRENT_ROUND_ACTION_TOP_K],
    [96, 32, 96],
    [160, 48, 160],
    [280, 64, 280],
    [480, 80, 480],
    [800, 96, CURRENT_ROUND_ACTION_TOP_K],
    [1400, 120, CURRENT_ROUND_ACTION_TOP_K],
    [2400, 144, CURRENT_ROUND_ACTION_TOP_K],
    [4000, 168, CURRENT_ROUND_ACTION_TOP_K],
  ];
  for (const [beamWidth, actionTopK, currentRoundActionTopK] of baseWidths) {
    if (shouldAbort()) break;
    const useOpponentSearch = input.objective === 'WIN_MARGIN' && beamWidth >= 280;
    const result = await runBeam(beamWidth, actionTopK, 0, currentRoundActionTopK, useOpponentSearch);
    if (!result) break;
    reportIfBetter(result, useOpponentSearch, beamWidth, actionTopK, currentRoundActionTopK);
  }

  // Phase 2: continuous deterministic widening passes. Earlier versions used
  // randomized ranking jitter here, which made the visible current move wobble
  // even when the board had not meaningfully changed. These passes now widen
  // the same ordered search profile, and robust first-move selection handles
  // near-ties without injecting noise.
  // Runs until aborted — there is no convergence shortcut.
  const restartProfiles: Array<[number, number]> = [
    [500, 96],
    [900, 128],
    [700, 112],
    [1400, 144],
    [1000, 160],
    [2000, 128],
    [1600, 176],
  ];
  const CYCLE_LEN = restartProfiles.length;
  const WIDTH_CAP = 50000;
  const K_CAP = 400;
  let restartSeed = 1;
  while (!shouldAbort()) {
    const cycle = Math.floor((restartSeed - 1) / CYCLE_LEN);
    // Growth: +25% per cycle (geometric). Capped so we don't balloon unboundedly.
    const widenMultiplier = Math.pow(1.25, cycle);
    const [baseW, baseK] = restartProfiles[(restartSeed - 1) % CYCLE_LEN];
    const w = Math.min(WIDTH_CAP, Math.round(baseW * widenMultiplier));
    const k = Math.min(K_CAP, Math.round(baseK * (1 + 0.15 * cycle)));
    const result = await runBeam(w, k, restartSeed, CURRENT_ROUND_ACTION_TOP_K, input.objective === 'WIN_MARGIN');
    restartSeed++;
    if (!result) break;
    reportIfBetter(result, input.objective === 'WIN_MARGIN', w, k);
  }

  if (!overallBest) {
    return {
      ok: true,
      plan: {
        projectedFinalVP: 0,
        objective: input.objective,
        analysisMode: 'FAST',
        objectiveScore: 0,
        projectedWinMargin: null,
        strongestOpponentVP: null,
        vpBreakdown: { scoreTrack: 0, politicsCards: 0, developments: 0, gloryTimesMajors: 0 },
        currentRound: null,
        futureRounds: [],
        moveAlternatives: [],
        currentPhase: input.currentPhase,
        partialResult: true,
        computeMs: Date.now() - start,
        exploredNodes: nodesExploredShared.count,
      },
    };
  }

  return {
    ok: true,
    plan: buildPlan(overallBest, cardIds, allCardObjs, nodesExploredShared, start, overallBestCtx ?? makeContext(0, 0), overallBestAlternatives),
  };
}

function analysisModeRank(ctx: SolverContext): number {
  if (ctx.opponentSearchEnabled) return 2;
  if (ctx.beamWidth >= 800) return 1;
  return 0;
}

function selectRobustBestEntry<T extends { state: SolverState; roundPlans: RoundPlan[]; objectiveScore: number }>(
  entries: T[],
  ctx: SolverContext,
): T | null {
  if (entries.length === 0) return null;
  const buckets = new Map<string, T[]>();
  for (const entry of entries) {
    const round = entry.roundPlans[0];
    const move = firstActionableMove(round, ctx.currentPhase);
    const signature = move ? recommendedMoveSignature(move) : roundSignature(round);
    const bucket = buckets.get(signature);
    if (bucket) bucket.push(entry);
    else buckets.set(signature, [entry]);
  }

  let bestBucket: { entry: T; robustScore: number; bestScore: number; samples: number } | null = null;
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => b.objectiveScore - a.objectiveScore);
    const supportIndex = bucket.length >= 12 ? 2 : bucket.length >= 4 ? 1 : 0;
    const robustScore = bucket[supportIndex].objectiveScore + Math.log2(bucket.length + 1) * 0.8;
    const bestScore = bucket[0].objectiveScore;
    if (!bestBucket
      || robustScore > bestBucket.robustScore
      || (robustScore === bestBucket.robustScore && bestScore > bestBucket.bestScore)
      || (robustScore === bestBucket.robustScore && bestScore === bestBucket.bestScore && bucket.length > bestBucket.samples)) {
      bestBucket = { entry: bucket[0], robustScore, bestScore, samples: bucket.length };
    }
  }
  return bestBucket?.entry ?? null;
}

function buildMoveAlternatives(
  entries: Array<{ state: SolverState; roundPlans: RoundPlan[]; objectiveScore: number }>,
  ctx: SolverContext,
  cardIds: string[],
  allCardObjs: PoliticsCard[],
): MoveAlternative[] {
  const buckets = new Map<string, {
    label: string;
    bestScore: number;
    bestFinalVP: number;
    bestMargin: number | null;
    samples: number;
  }>();

  for (const entry of entries) {
    const move = firstActionableMove(entry.roundPlans[0], ctx.currentPhase);
    const signature = move ? recommendedMoveSignature(move) : roundSignature(entry.roundPlans[0]);
    const finalized = finalizeScore(entry.state, cardIds, allCardObjs);
    const margin = ctx.objective === 'WIN_MARGIN'
      ? finalized.total - estimateStrongestOpponentVP(entry.state, ctx, ctx.opponentSearchEnabled)
      : null;
    const existing = buckets.get(signature);
    if (!existing) {
      buckets.set(signature, {
        label: move ? recommendedMoveLabel(move, cardIds, allCardObjs) : (entry.roundPlans[0]?.description[0] ?? 'No move'),
        bestScore: entry.objectiveScore,
        bestFinalVP: finalized.total,
        bestMargin: margin,
        samples: 1,
      });
      continue;
    }
    existing.samples += 1;
    if (entry.objectiveScore > existing.bestScore) {
      existing.bestScore = entry.objectiveScore;
      existing.bestFinalVP = finalized.total;
      existing.bestMargin = margin;
    }
  }

  const ranked = Array.from(buckets.values()).sort((a, b) => b.bestScore - a.bestScore);
  const best = ranked[0]?.bestScore ?? 0;
  return ranked.slice(0, 4).map((bucket) => ({
    label: bucket.label,
    objectiveScore: bucket.bestScore,
    projectedFinalVP: bucket.bestFinalVP,
    projectedWinMargin: bucket.bestMargin,
    deltaFromBest: bucket.bestScore - best,
    samples: bucket.samples,
  }));
}

function firstActionableMove(round: RoundPlan | null | undefined, phase: GamePhase): RecommendedMove | null {
  const moves = round?.recommendedMoves ?? [];
  if (phase === 'DICE') return moves.find(m => m.kind === 'ASSIGN_DICE') ?? null;
  if (phase === 'ACTIONS') return moves.find(m => m.kind === 'RESOLVE_ACTION') ?? null;
  if (phase === 'PROGRESS') return moves.find(m => m.kind === 'PROGRESS_TRACK') ?? null;
  if (phase === 'ACHIEVEMENT') return moves.find(m => m.kind === 'ACHIEVEMENT_TRACK_CHOICE') ?? null;
  return moves.find(m => m.kind === 'RESOLVE_ACTION')
    ?? moves.find(m => m.kind === 'ASSIGN_DICE')
    ?? moves.find(m => m.kind === 'PROGRESS_TRACK')
    ?? moves[0]
    ?? null;
}

function recommendedMoveSignature(move: RecommendedMove): string {
  if (move.kind === 'RESOLVE_ACTION') {
    return `${move.kind}:${move.actionType}:${JSON.stringify(move.choices)}`;
  }
  if (move.kind === 'ASSIGN_DICE') {
    return `${move.kind}:${move.assignments.map(a => `${a.action}:${a.dieValue}`).join('|')}`;
  }
  if (move.kind === 'PROGRESS_TRACK') {
    return `${move.kind}:${move.tracks.join('|')}:${move.philosophySpent}`;
  }
  return `${move.kind}:${move.choices.join('|')}`;
}

function roundSignature(round: RoundPlan | null | undefined): string {
  return round ? round.actionTypes.join('>') : '';
}

function recommendedMoveLabel(move: RecommendedMove, cardIds: string[], allCardObjs: PoliticsCard[]): string {
  if (move.kind === 'ASSIGN_DICE') {
    return `Dice: ${move.assignments.map(a => `${formatActionName(a.action)} ${a.dieValue}`).join(', ')}`;
  }
  if (move.kind === 'PROGRESS_TRACK') {
    return `Progress: ${move.tracks.join(', ')}`;
  }
  if (move.kind === 'ACHIEVEMENT_TRACK_CHOICE') {
    return `Achievement: ${move.choices.join(', ')}`;
  }
  if (move.choice.type === 'POLITICS') {
    const card = allCardObjs[move.choice.cardIndex];
    return `Politics: play ${card?.name ?? cardIds[move.choice.cardIndex] ?? 'card'}`;
  }
  return `${formatActionName(move.actionType)} action`;
}

function buildPlan(
  best: { state: SolverState; roundPlans: RoundPlan[] },
  cardIds: string[],
  allCardObjs: PoliticsCard[],
  nodesExploredShared: { count: number },
  start: number,
  ctx: SolverContext,
  moveAlternatives: MoveAlternative[] = [],
  partialResult: boolean = false,
): Plan {
  const finalized = finalizeScore(best.state, cardIds, allCardObjs);
  const strongestOpponentVP = ctx.fullState ? estimateStrongestOpponentVP(best.state, ctx, ctx.opponentSearchEnabled) : null;
  const projectedWinMargin = strongestOpponentVP === null ? null : finalized.total - strongestOpponentVP;
  const objectiveScore = ctx.objective === 'WIN_MARGIN' && projectedWinMargin !== null
    ? projectedWinMargin
    : finalized.total;
  const analysisMode: SolverAnalysisMode = ctx.opponentSearchEnabled
    ? 'ADVERSARIAL'
    : ctx.beamWidth >= 800
      ? 'DEEP'
      : 'FAST';
  const currentRound = best.roundPlans.length > 0 ? best.roundPlans[0] : null;
  const futureRounds = best.roundPlans.slice(1);
  return {
    projectedFinalVP: finalized.total,
    objective: ctx.objective,
    analysisMode,
    objectiveScore,
    projectedWinMargin,
    strongestOpponentVP,
    vpBreakdown: finalized.breakdown,
    currentRound,
    futureRounds,
    moveAlternatives,
    currentPhase: ctx.currentPhase,
    partialResult,
    computeMs: Date.now() - start,
    exploredNodes: nodesExploredShared.count,
  };
}
