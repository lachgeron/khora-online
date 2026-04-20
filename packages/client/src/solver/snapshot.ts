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

  const resolvedSlots = me.actionSlots.filter(s => s.resolved);
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

  // Citizens-12 achievement already processed? Any past-achievement phase in round 1 or later.
  // If the snapshot is taken after R1 achievement phase, we conservatively treat the reward as
  // already granted (since taxTrack/gloryTrack reflect the current state).
  const citizensAchievementClaimed =
    publicState.roundNumber > 1 ||
    (publicState.roundNumber === 1 && publicState.currentPhase === 'ACHIEVEMENT');

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

  return {
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
    citizensAchievementClaimed,
    opponents,
    boardTokens,
  };
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
