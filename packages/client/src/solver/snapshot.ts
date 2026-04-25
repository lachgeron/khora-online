/**
 * Extract a SolverInput from the live client game state.
 */

import type {
  PublicGameState,
  PrivatePlayerState,
  ActionType,
  KnowledgeToken,
} from '../types';
import type { SolverInput, SolverAction, FrozenOpponent, BoardExplorationToken } from './types';
import { buildInitialState } from './solver';
import { applyTaxPhase } from './scoring';
import { getAchievement } from './achievements';

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
): SolverInput | null {
  const me = publicState.players.find(p => p.playerId === myPlayerId);
  if (!me) return null;

  const others = publicState.players.filter(p => p.playerId !== myPlayerId);
  const opponents: FrozenOpponent[] = others.map(o => ({
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
    cityId: me.cityId,
    developmentLevel: me.developmentLevel,
    coins: privateState.coins,
    philosophyTokens: privateState.philosophyTokens,
    knowledgeTokens,
    economyTrack: me.economyTrack,
    cultureTrack: me.cultureTrack,
    militaryTrack: me.militaryTrack,
    taxTrack: me.taxTrack,
    gloryTrack: me.gloryTrack,
    troopTrack: me.troopTrack,
    citizenTrack: me.citizenTrack,
    victoryPoints: me.victoryPoints,
    handCards: privateState.handCards,
    playedCards: privateState.playedCards,
    currentRound: publicState.roundNumber,
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
    const cardIds = [...rawInput.handCards, ...rawInput.playedCards].map(c => c.id);
    const state = buildInitialState(rawInput, cardIds);
    applyTaxPhase(state, rawInput.opponents, (id) => {
      const idx = cardIds.indexOf(id);
      return idx >= 0 && (state.playedMask & (1 << idx)) !== 0;
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
