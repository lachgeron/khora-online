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

  // Progress already done? Detect from phase: after PROGRESS phase of the current round.
  const progressAlreadyDone =
    publicState.currentPhase === 'GLORY' || publicState.currentPhase === 'ACHIEVEMENT';

  // Achievements still claimable THIS round. The server keeps unclaimed
  // achievements in `availableAchievements`; once the achievement phase runs,
  // anything claimed is removed from that list. So once we've reached the
  // ACHIEVEMENT phase of a round, this round's claim opportunity is gone —
  // pass an empty list so the solver doesn't double-count. The solver itself
  // only ever attempts to claim on the *initial* simulated round (per spec:
  // future-round achievements are assumed to be taken by opponents).
  const achievementPhaseDone = publicState.currentPhase === 'ACHIEVEMENT';
  const availableAchievementIds = achievementPhaseDone
    ? []
    : (publicState.availableAchievements ?? [])
      .map(a => a.id)
      .filter(id => getAchievement(id) !== null);

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
