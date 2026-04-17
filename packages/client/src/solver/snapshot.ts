/**
 * Extract a SolverInput from the live client game state.
 */

import type {
  PublicGameState,
  PrivatePlayerState,
  ActionType,
  KnowledgeToken,
} from '../types';
import type { SolverInput, SolverAction, FrozenOpponent } from './types';

const ACTION_MAP: Record<ActionType, SolverAction | null> = {
  PHILOSOPHY: 'PHILOSOPHY',
  LEGISLATION: null, // skipped
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
  const actionsAlreadyTaken: SolverAction[] = resolvedSlots
    .map(s => ACTION_MAP[s.actionType])
    .filter((a): a is SolverAction => a !== null);
  const slotsConsumedThisRound = resolvedSlots.length;

  // Progress already done? Detect from phase: after PROGRESS phase of the current round.
  const progressAlreadyDone =
    publicState.currentPhase === 'GLORY' || publicState.currentPhase === 'ACHIEVEMENT';

  const knowledgeTokens: KnowledgeToken[] = privateState.knowledgeTokens;

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
    opponents,
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
