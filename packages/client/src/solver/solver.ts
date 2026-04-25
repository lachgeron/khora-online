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
} from './types';
import type { PoliticsCard, ProgressTrackType } from '../types';
import { enumerateActionPlans, heuristicScore } from './action-enum';
import { enumerateProgressPlans } from './progress-enum';
import { applyTaxPhase, finalizeScore } from './scoring';
import { cloneState, popcount } from './card-data';
import { canSolveFromPhase } from './snapshot';
import { getAchievement } from './achievements';
import type { PublicGameState } from '../types';

// ─── Setup: build cardIds/allCards list and initial state ───────────────────

interface SolverContext {
  cardIds: string[];
  allCards: PoliticsCard[];
  opponents: FrozenOpponent[];
  boardTokens: BoardExplorationToken[];
  shouldAbort: () => boolean;
  nodesExplored: { count: number };
  beamWidth: number;
  actionTopK: number;
  initialRound: number;    // the first round we were asked to plan for
  initialRoundTaxApplied: boolean;  // if true, skip tax at end of the first simulated round
  // Achievements still on the board THIS round (the initial round only).
  // Future rounds in the search assume these are gone (taken by opponents).
  availableAchievementIds: string[];
}

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
    if (idx >= 0) handMask |= 1 << idx;
  }
  for (const c of input.playedCards) {
    const idx = cardIds.indexOf(c.id);
    if (idx >= 0) playedMask |= 1 << idx;
  }

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
    victoryPoints: input.victoryPoints,
  };
}

// ─── Round simulation ────────────────────────────────────────────────────────

interface RoundResult {
  stateAfter: SolverState;
  chosenActions: ActionChoice[];
  progressTracks: ProgressTrackType[];
  philosophySpent: number;
  description: string[];
  vpBefore: number;
  vpAfter: number;
  coinsBefore: number;
  coinsAfter: number;
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

  // 1. Action phase: enumerate action plans for remaining slots.
  const maxSlots = s.cultureTrack >= 4 ? 3 : 2;
  const slotsLeft = Math.max(0, maxSlots - s.slotsConsumedThisRound);
  const actionPlans = enumerateActionPlans(
    s,
    slotsLeft,
    ctx.cardIds,
    ctx.allCards,
    ctx.opponents,
    ctx.boardTokens,
    ctx.actionTopK,
  );
  ctx.nodesExplored.count += actionPlans.length;

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

  for (const ap of actionPlans) {
    if (ctx.shouldAbort()) break;
    const progressCandidates = enumerateProgressPlans(
      ap.state,
      ctx.opponents,
      (id) => hasCard(ap.state, id, ctx.cardIds),
      (id) => devUnlocked(ap.state, id),
    );
    ctx.nodesExplored.count += progressCandidates.length;

    for (const pState of progressCandidates) {
      // Achievement phase. Per spec, only the *initial* simulated round
      // attempts to claim — future rounds assume opponents have grabbed
      // whatever's still available. Each qualifying achievement contributes
      // a +1 Tax or +1 Glory choice; we branch over all (i Tax, N-i Glory)
      // splits so the beam picks whichever serves end-game scoring best.
      const postAchievementStates = pState.round === ctx.initialRound
        ? applyAchievementPhase(pState, ctx.availableAchievementIds)
        : [{ state: pState, claimedNames: [] as string[], taxAdd: 0, gloryAdd: 0 }];

      for (const ach of postAchievementStates) {
        const afterTax = cloneState(ach.state);
        if (!skipTax) {
          applyTaxPhase(afterTax, ctx.opponents, (id) => hasCard(afterTax, id, ctx.cardIds));
        }
        const score = heuristicScore(afterTax, ctx.cardIds);
        const progressTracks = diffProgressTracks(ap.state, pState);
        const philosophySpent = ap.state.philosophyTokens - pState.philosophyTokens;
        const achievementDelta = ach.claimedNames.length > 0
          ? formatAchievementDelta(ach.claimedNames, ach.taxAdd, ach.gloryAdd)
          : null;
        scored.push({
          score,
          result: {
            stateAfter: afterTax,
            chosenActions: ap.choices,
            progressTracks,
            philosophySpent,
            description: describeRound(
              ap.choices,
              progressTracks,
              philosophySpent,
              ctx.cardIds,
              ctx.allCards,
              hasCard(pState, 'old-guard', ctx.cardIds),
              achievementDelta,
            ),
            vpBefore,
            vpAfter: afterTax.victoryPoints,
            coinsBefore,
            coinsAfter: afterTax.coins,
          },
        });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(x => x.result);
}

/**
 * Achievement-phase resolution (initial round only — see caller).
 *
 * Looks at every achievement still on the board, checks which the state
 * qualifies for, and returns one branch per (taxAdd, gloryAdd) split:
 * for N qualifying achievements there are N+1 branches (i Tax + (N-i) Glory
 * for i in 0..N). Each claim is independent — multiple achievements stack.
 *
 * The per-achievement +1 Tax / +1 Glory choice collapses to N+1 outcomes
 * (rather than 2^N) because the resulting state depends only on the totals,
 * not which specific achievement got which choice.
 */
function applyAchievementPhase(
  s: SolverState,
  availableAchievementIds: string[],
): Array<{ state: SolverState; claimedNames: string[]; taxAdd: number; gloryAdd: number }> {
  const claimedNames: string[] = [];
  for (const id of availableAchievementIds) {
    const def = getAchievement(id);
    if (def && def.qualifies(s)) claimedNames.push(def.name);
  }
  if (claimedNames.length === 0) {
    return [{ state: s, claimedNames: [], taxAdd: 0, gloryAdd: 0 }];
  }

  const branches: Array<{ state: SolverState; claimedNames: string[]; taxAdd: number; gloryAdd: number }> = [];
  for (let taxAdd = 0; taxAdd <= claimedNames.length; taxAdd++) {
    const gloryAdd = claimedNames.length - taxAdd;
    const variant = cloneState(s);
    variant.taxTrack += taxAdd;
    variant.gloryTrack += gloryAdd;
    branches.push({ state: variant, claimedNames, taxAdd, gloryAdd });
  }
  return branches;
}

function formatAchievementDelta(names: string[], taxAdd: number, gloryAdd: number): string {
  const parts: string[] = [];
  if (taxAdd > 0) parts.push(`+${taxAdd} Tax`);
  if (gloryAdd > 0) parts.push(`+${gloryAdd} Glory`);
  return `${names.join(', ')} (${parts.join(', ')})`;
}

function hasCard(s: SolverState, id: string, cardIds: string[]): boolean {
  const idx = cardIds.indexOf(id);
  return idx >= 0 && (s.playedMask & (1 << idx)) !== 0;
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
  achievementDelta: string | null,
): string[] {
  const bullets: string[] = [];
  for (const c of choices) {
    bullets.push(describeChoice(c, cardIds, allCards));
  }
  if (progressTracks.length > 0) {
    const counts = { ECONOMY: 0, CULTURE: 0, MILITARY: 0 };
    for (const t of progressTracks) counts[t]++;
    const parts: string[] = [];
    if (counts.ECONOMY) parts.push(`+${counts.ECONOMY} Economy`);
    if (counts.CULTURE) parts.push(`+${counts.CULTURE} Culture`);
    if (counts.MILITARY) parts.push(`+${counts.MILITARY} Military`);
    let msg = `Progress: ${parts.join(', ')}`;
    if (philosophySpent > 0) msg += ` (spent ${philosophySpent} scrolls)`;
    bullets.push(msg);
  } else {
    bullets.push(hasOldGuard ? 'Progress: skip (Old Guard +4 VP)' : 'Progress: skip (nothing affordable)');
  }
  if (achievementDelta) {
    bullets.push(`Achievement: 12 Citizens (${achievementDelta})`);
  }
  return bullets;
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
    case 'DEVELOPMENT': return `Development — unlock next level${c.philosophyPairs ? ` (+${c.philosophyPairs * 2} scrolls)` : ''}`;
    case 'LEGISLATION': return 'Legislation — +3 citizens';
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
  // Achievements: only the initial round considers claims (per spec — future
  // rounds assume opponents have grabbed whatever's still on the board), so
  // there's no per-round flag to reset here.
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
    `${s.handMask}|${s.playedMask}|${s.victoryPoints}|${s.coins}|${s.philosophyTokens}|` +
    `${s.economyTrack}|${s.cultureTrack}|${s.militaryTrack}|${s.taxTrack}|${s.gloryTrack}|` +
    `${s.troopTrack}|${s.citizenTrack}|${s.developmentLevel}|` +
    `${s.knowledge.greenMinor},${s.knowledge.blueMinor},${s.knowledge.redMinor},` +
    `${s.knowledge.greenMajor},${s.knowledge.blueMajor},${s.knowledge.redMajor}`;

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

  const allCardObjs = [...input.handCards, ...input.playedCards];
  const cardIds = allCardObjs.map(c => c.id);

  const initialState = buildInitialState(input, cardIds);

  interface BeamEntry {
    state: SolverState;
    roundPlans: RoundPlan[];
  }

  const nodesExploredShared = { count: 0 };

  /**
   * Deterministic jitter for ranking diversity in restart passes. Amplitude scales
   * with |seed| so later restarts perturb rankings more aggressively and expose
   * trajectories the main beam pruned. When seed=0 the jitter is 0 (pure heuristic).
   */
  const rankJitter = (s: SolverState, seed: number): number => {
    if (seed === 0) return 0;
    let h = seed * 2654435761;
    h ^= s.handMask | 0;
    h ^= (s.playedMask | 0) * 31;
    h ^= (s.victoryPoints | 0) * 97;
    h ^= (s.coins | 0) * 131;
    h ^= (s.economyTrack | 0) * 7 + (s.cultureTrack | 0) * 11 + (s.militaryTrack | 0) * 13;
    h ^= (s.developmentLevel | 0) * 17 + (s.philosophyTokens | 0) * 19 + (s.troopTrack | 0) * 23;
    h ^= (s.taxTrack | 0) * 29 + (s.gloryTrack | 0) * 37 + (s.citizenTrack | 0) * 41;
    h = (h ^ (h >>> 16)) >>> 0;
    const amp = Math.min(6, 1.5 + Math.abs(seed) * 0.3);
    return ((h / 0xffffffff) - 0.5) * amp;
  };

  /** Run a full 9-round beam search with the given widths. Returns best trajectory or null if aborted. */
  const runBeam = async (beamWidth: number, actionTopK: number, seed: number = 0): Promise<BeamEntry | null> => {
    const ctx: SolverContext = {
      cardIds,
      allCards: allCardObjs,
      opponents: input.opponents,
      boardTokens: input.boardTokens,
      shouldAbort,
      nodesExplored: nodesExploredShared,
      beamWidth,
      actionTopK,
      initialRound: initialState.round,
      initialRoundTaxApplied: input.initialRoundTaxApplied,
      availableAchievementIds: input.availableAchievementIds,
    };

    let beam: BeamEntry[] = [{ state: initialState, roundPlans: [] }];

    for (let round = initialState.round; round <= 9; round++) {
      if (shouldAbort()) return null;
      const nextBeam: BeamEntry[] = [];
      for (const entry of beam) {
        if (shouldAbort()) return null;
        const stateAtRound = { ...entry.state, round };
        const results = simulateRoundTopK(stateAtRound, ctx, beamWidth);
        for (const r of results) {
          nextBeam.push({
            state: advanceToNextRound(r.stateAfter),
            roundPlans: [
              ...entry.roundPlans,
              {
                round,
                description: r.description,
                actionTypes: r.chosenActions.map(c => c.type),
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
        (heuristicScore(b.state, cardIds) + rankJitter(b.state, seed)) -
        (heuristicScore(a.state, cardIds) + rankJitter(a.state, seed))
      );
      beam = diversifyBeam(nextBeam, beamWidth);
      // Yield to host event loop between rounds so pending worker messages
      // (abort/restart) get processed without waiting for the full pass.
      await yieldToHost();
    }

    let best: BeamEntry | null = null;
    let bestScore = -Infinity;
    for (const entry of beam) {
      const sc = finalizeScore(entry.state, cardIds, allCardObjs).total;
      if (sc > bestScore) { bestScore = sc; best = entry; }
    }
    return best;
  };

  let overallBest: BeamEntry | null = null;
  let overallBestVP = -Infinity;

  const reportIfBetter = (result: BeamEntry): void => {
    const vp = finalizeScore(result.state, cardIds, allCardObjs).total;
    if (vp <= overallBestVP) return;
    overallBestVP = vp;
    overallBest = result;
    if (onProgress) onProgress(buildPlan(result, cardIds, allCardObjs, nodesExploredShared, start));
  };

  // Phase 1: iterative deepening — start narrow (fast first result) and widen
  // progressively until the profile saturates or we're aborted.
  const baseWidths: Array<[number, number]> = [
    [12, 12],
    [24, 16],
    [48, 20],
    [80, 24],
    [120, 28],
    [200, 32],
    [320, 36],
    [500, 40],
    [800, 44],
    [1200, 48],
    [2000, 52],
  ];
  for (const [beamWidth, actionTopK] of baseWidths) {
    if (shouldAbort()) break;
    const result = await runBeam(beamWidth, actionTopK);
    if (!result) break;
    reportIfBetter(result);
  }

  // Phase 2: continuous randomized restarts with progressively widening profiles.
  // Each cycle through `restartProfiles` is scaled up by `widenMultiplier`, so
  // later cycles explore deeper rather than just re-rolling the same geometry.
  // Runs until aborted — there is no convergence shortcut.
  const restartProfiles: Array<[number, number]> = [
    [120, 24],
    [200, 32],
    [160, 28],
    [300, 36],
    [200, 40],
    [400, 32],
    [250, 44],
  ];
  const CYCLE_LEN = restartProfiles.length;
  const WIDTH_CAP = 50000;
  const K_CAP = 200;
  let restartSeed = 1;
  while (!shouldAbort()) {
    const cycle = Math.floor((restartSeed - 1) / CYCLE_LEN);
    // Growth: +25% per cycle (geometric). Capped so we don't balloon unboundedly.
    const widenMultiplier = Math.pow(1.25, cycle);
    const [baseW, baseK] = restartProfiles[(restartSeed - 1) % CYCLE_LEN];
    const w = Math.min(WIDTH_CAP, Math.round(baseW * widenMultiplier));
    const k = Math.min(K_CAP, Math.round(baseK * (1 + 0.15 * cycle)));
    const result = await runBeam(w, k, restartSeed);
    restartSeed++;
    if (!result) break;
    reportIfBetter(result);
  }

  if (!overallBest) {
    return {
      ok: true,
      plan: {
        projectedFinalVP: 0,
        vpBreakdown: { scoreTrack: 0, politicsCards: 0, developments: 0, gloryTimesMajors: 0 },
        currentRound: null,
        futureRounds: [],
        partialResult: true,
        computeMs: Date.now() - start,
        exploredNodes: nodesExploredShared.count,
      },
    };
  }

  return {
    ok: true,
    plan: buildPlan(overallBest, cardIds, allCardObjs, nodesExploredShared, start),
  };
}

function buildPlan(
  best: { state: SolverState; roundPlans: RoundPlan[] },
  cardIds: string[],
  allCardObjs: PoliticsCard[],
  nodesExploredShared: { count: number },
  start: number,
): Plan {
  const finalized = finalizeScore(best.state, cardIds, allCardObjs);
  const currentRound = best.roundPlans.length > 0 ? best.roundPlans[0] : null;
  const futureRounds = best.roundPlans.slice(1);
  return {
    projectedFinalVP: finalized.total,
    vpBreakdown: finalized.breakdown,
    currentRound,
    futureRounds,
    partialResult: false,
    computeMs: Date.now() - start,
    exploredNodes: nodesExploredShared.count,
  };
}
