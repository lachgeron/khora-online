/**
 * Extract a SolverInput from the live client game state.
 */

import type {
  PublicGameState,
  PrivatePlayerState,
  ActionType,
  KnowledgeToken,
  PoliticsCard,
} from '../types';
import type { SolverInput, SolverAction, FrozenOpponent, BoardExplorationToken, SolverDiceAssignment } from './types';
import type { SolverObjective } from './types';
import { ACTION_NUMBERS } from '../types';
import { buildInitialState } from './solver';
import { applyTaxPhase } from './scoring';
import { getAchievement } from './achievements';
import { hasMaskBit } from './card-data';

const ACTION_MAP: Record<ActionType, SolverAction | null> = {
  PHILOSOPHY: 'PHILOSOPHY',
  LEGISLATION: 'LEGISLATION', // tracked via legislationDoneThisRound flag separately
  CULTURE: 'CULTURE',
  TRADE: 'TRADE',
  MILITARY: 'MILITARY',
  POLITICS: 'POLITICS',
  DEVELOPMENT: 'DEVELOPMENT',
};

/** Build a SolverInput from the current game state + our private state. */
export function buildSolverInput(
  publicState: PublicGameState,
  privateState: PrivatePlayerState,
  myPlayerId: string,
  godMode = false,
  objective: SolverObjective = 'MAX_VP',
): SolverInput | null {
  const me = publicState.players.find(p => p.playerId === myPlayerId);
  if (!me) return null;

  const fullState = privateState.solverFullState;
  const fullMe = fullState?.players.find(p => p.playerId === myPlayerId);
  const others = publicState.players.filter(p => p.playerId !== myPlayerId);
  const opponents: FrozenOpponent[] = fullState
    ? fullState.players
      .filter(p => p.playerId !== myPlayerId)
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
      }))
    : others.map(o => ({
        playerId: o.playerId,
        economyTrack: o.economyTrack,
        cultureTrack: o.cultureTrack,
        militaryTrack: o.militaryTrack,
      }));

  // Action slots only get cleared when the DICE phase begins. During OMEN /
  // TAXATION of round N, the slots still hold the resolved actions from round
  // N-1 — treating them as "already taken this round" would make the solver
  // believe the action phase is done before it has started. Any phase before
  // DICE is considered "round not yet begun" for slot-tracking purposes.
  const phasesBeforeDice: Array<typeof publicState.currentPhase> = ['OMEN', 'TAXATION'];
  const slotsAreFresh = phasesBeforeDice.includes(publicState.currentPhase);
  const resolvedSlots = slotsAreFresh
    ? []
    : me.actionSlots.filter(s => s.resolved);
  const legislationDoneThisRound = resolvedSlots.some(s => s.actionType === 'LEGISLATION');
  // LEGISLATION is tracked both in actionsAlreadyTaken and via its own flag. It consumes
  // a slot like any other action (R1 opening: max 2 actions total).
  const actionsAlreadyTaken: SolverAction[] = resolvedSlots
    .map(s => ACTION_MAP[s.actionType])
    .filter((a): a is SolverAction => a !== null);
  const slotsConsumedThisRound = resolvedSlots.length;
  const privateActionSlots = fullMe?.actionSlots ?? privateState.actionSlots;
  const unresolvedAssignedActions: SolverDiceAssignment[] = slotsAreFresh
    ? []
    : privateActionSlots
      .filter((s): s is NonNullable<typeof s> => s !== null && !s.resolved)
      .map(s => ({
        action: ACTION_MAP[s.actionType]!,
        dieValue: s.assignedDie,
        citizenCost: s.citizenCost,
      }))
      .filter(a => a.action !== null)
      .sort((a, b) => ACTION_NUMBERS[a.action] - ACTION_NUMBERS[b.action]);

  // Progress already done? Each player resolves a single PROGRESS_TRACK
  // decision (or SKIP_PHASE) during the PROGRESS phase, after which the
  // server removes the decision. So progress is done if we're past the phase
  // OR we're in PROGRESS phase but our pending decision has been resolved.
  const myPendingDecisionTypes = (publicState.pendingDecisions ?? [])
    .filter(d => d.playerId === myPlayerId)
    .map(d => d.decisionType);
  const progressDecisionPending = myPendingDecisionTypes.includes('PROGRESS_TRACK');
  const progressAlreadyDone =
    publicState.currentPhase === 'GLORY' ||
    publicState.currentPhase === 'ACHIEVEMENT' ||
    (publicState.currentPhase === 'PROGRESS' && !progressDecisionPending);

  // Achievements pending for THIS round split into two sub-cases.
  //
  // (1) Pre-ACHIEVEMENT phase: the solver predicts which achievements we'll
  //     QUALIFY for at end of round, choosing actions/progress so that we hit
  //     them. `availableAchievementIds` lists what's still on the board.
  //
  // (2) ACHIEVEMENT phase: claims have already been determined server-side,
  //     and what remains for the player is one Tax/Glory pick per claim.
  //     `availableAchievementIds` is empty (we're past the qualify check),
  //     and `pendingAchievementChoices` carries the count of pending picks
  //     so the solver can branch on the best (Tax, Glory) split.
  //
  // Per spec, only the *initial* simulated round considers either case —
  // future rounds in the search assume opponents have grabbed the rest.
  const achievementPhaseDone = publicState.currentPhase === 'ACHIEVEMENT';
  const availableAchievementIds = achievementPhaseDone
    ? []
    : (publicState.availableAchievements ?? [])
      .map(a => a.id)
      .filter(id => getAchievement(id) !== null);
  const pendingAchievementChoices = myPendingDecisionTypes
    .filter(t => t === 'ACHIEVEMENT_TRACK_CHOICE').length;

  const knowledgeTokens: KnowledgeToken[] = privateState.knowledgeTokens;

  // Central-board tokens: include unexplored only, strip to solver's flat shape.
  // Persepolis is modelled separately because it grants 3 majors at once.
  const boardTokens: BoardExplorationToken[] = (publicState.centralBoardTokens ?? [])
    .filter(t => !t.explored && t.militaryRequirement !== undefined)
    .map(t => ({
      id: t.id,
      color: t.color,
      tokenType: t.tokenType,
      militaryRequirement: t.militaryRequirement ?? 0,
      skullCost: t.skullValue ?? 0,
      bonusCoins: t.bonusCoins ?? 0,
      bonusVP: t.bonusVP ?? 0,
      isPersepolis: t.isPersepolis,
    }));

  const rawInput: SolverInput = {
    playerId: myPlayerId,
    cityId: me.cityId,
    developmentLevel: me.developmentLevel,
    coins: fullMe?.coins ?? privateState.coins,
    philosophyTokens: fullMe?.philosophyTokens ?? privateState.philosophyTokens,
    knowledgeTokens: fullMe?.knowledgeTokens ?? knowledgeTokens,
    economyTrack: fullMe?.economyTrack ?? me.economyTrack,
    cultureTrack: fullMe?.cultureTrack ?? me.cultureTrack,
    militaryTrack: fullMe?.militaryTrack ?? me.militaryTrack,
    taxTrack: fullMe?.taxTrack ?? me.taxTrack,
    gloryTrack: fullMe?.gloryTrack ?? me.gloryTrack,
    troopTrack: fullMe?.troopTrack ?? me.troopTrack,
    citizenTrack: fullMe?.citizenTrack ?? me.citizenTrack,
    victoryPoints: fullMe?.victoryPoints ?? me.victoryPoints,
    handCards: fullMe?.handCards ?? privateState.handCards,
    playedCards: fullMe?.playedCards ?? privateState.playedCards,
    availableGodModeCards: fullState?.politicsDeck ?? privateState.availableGodModeCards,
    godMode,
    objective,
    fullState,
    predeterminedDice: fullState?.predeterminedDice ?? null,
    currentRound: publicState.roundNumber,
    currentPhase: publicState.currentPhase,
    diceRoll: fullMe?.diceRoll ?? privateState.diceRoll,
    unresolvedAssignedActions,
    actionsAlreadyTaken,
    slotsConsumedThisRound,
    progressAlreadyDone,
    legislationDoneThisRound,
    availableAchievementIds,
    pendingAchievementChoices,
    initialRoundTaxApplied: publicState.currentPhase !== 'OMEN',
    opponents,
    boardTokens,
  };

  // Canonicalize OMEN to post-tax state. OMEN → TAXATION is an automatic
  // transition that always changes coins (by taxTrack + stadion/power/market
  // bonuses) but never changes the solver's plan. By pre-applying the tax
  // phase on OMEN snapshots, both phases produce identical SolverInputs so
  // the hook's structural equality check matches and the worker is not
  // restarted on that transition.
  if (publicState.currentPhase === 'OMEN') {
    const cardIds = cardsForSolver(rawInput).map(c => c.id);
    const state = buildInitialState(rawInput, cardIds);
    applyTaxPhase(state, rawInput.opponents, (id) => {
      const idx = cardIds.indexOf(id);
      return idx >= 0 && hasMaskBit(state.playedMask, idx);
    });
    return {
      ...rawInput,
      coins: state.coins,
      victoryPoints: state.victoryPoints,
      troopTrack: state.troopTrack,
      taxTrack: state.taxTrack,
      gloryTrack: state.gloryTrack,
      initialRoundTaxApplied: true,
    };
  }

  return rawInput;
}

export function cardsForSolver(input: Pick<SolverInput, 'handCards' | 'playedCards' | 'availableGodModeCards' | 'godMode'>): PoliticsCard[] {
  const cards: PoliticsCard[] = [];
  const seen = new Set<string>();
  for (const c of input.handCards) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    cards.push(c);
  }
  for (const c of input.playedCards) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    cards.push(c);
  }
  if (input.godMode) {
    for (const c of input.availableGodModeCards) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      cards.push(c);
    }
  }
  return cards;
}

/** Determine whether the solver can produce a plan from this phase. */
export function canSolveFromPhase(publicState: PublicGameState): {
  ok: boolean;
  reason?: 'PRE_GAME' | 'GAME_OVER' | 'UNKNOWN';
  message?: string;
} {
  const phase = publicState.currentPhase;
  if (phase === 'LOBBY' || phase === 'CITY_SELECTION' || phase === 'DRAFT_POLITICS') {
    return { ok: false, reason: 'PRE_GAME', message: 'Solver unavailable during setup/draft phases.' };
  }
  if (phase === 'GAME_OVER' || phase === 'FINAL_SCORING' || publicState.finalScores != null) {
    return { ok: false, reason: 'GAME_OVER', message: 'The game is already over.' };
  }
  return { ok: true };
}
