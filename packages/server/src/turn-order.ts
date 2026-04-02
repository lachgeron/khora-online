/**
 * Turn order management for Khora Online.
 *
 * Per the official rules:
 * - The player who rolls the lowest dice total becomes start player.
 * - If tied, the tied player closest to the previous start player
 *   going clockwise wins the tie.
 * - Turn order follows clockwise from start player (in our case, array order).
 * - Military action (action 4) and Progress phase resolve in turn order.
 */

import type { GameState } from '@khora/shared';

/**
 * Determines the start player and turn order based on dice totals.
 * Lowest total becomes start player.
 * Ties broken by clockwise proximity to the previous round's start player.
 */
export function determineTurnOrder(state: GameState): GameState {
  const connectedPlayers = state.players.filter(p => p.isConnected);

  const playerTotals = connectedPlayers.map(p => ({
    playerId: p.playerId,
    total: p.diceRoll ? p.diceRoll.reduce((a, b) => a + b, 0) : Infinity,
  }));

  // Build a clockwise seating order starting from the previous start player.
  // The players array represents seating order; we rotate so that the
  // player *after* the previous start player has the lowest tiebreak value.
  const allIds = state.players.map(p => p.playerId);
  const prevStartIdx = allIds.indexOf(state.startPlayerId);

  function clockwiseDistance(playerId: string): number {
    const idx = allIds.indexOf(playerId);
    if (idx === -1) return Infinity;
    // Distance going clockwise from the previous start player
    // The previous start player themselves has the highest distance (full circle)
    // so the player immediately after them wins ties.
    return ((idx - prevStartIdx - 1 + allIds.length) % allIds.length);
  }

  // Sort by dice total ascending, then by clockwise distance from prev start player
  playerTotals.sort((a, b) => {
    if (a.total !== b.total) return a.total - b.total;
    return clockwiseDistance(a.playerId) - clockwiseDistance(b.playerId);
  });

  const turnOrder = playerTotals.map(pt => pt.playerId);
  const startPlayerId = turnOrder.length > 0 ? turnOrder[0] : state.startPlayerId;

  return {
    ...state,
    startPlayerId,
    turnOrder,
  };
}

/**
 * Returns the next player in turn order after the given player.
 * Returns null if the given player is the last in turn order.
 */
export function getNextPlayer(state: GameState, currentPlayerId: string): string | null {
  const idx = state.turnOrder.indexOf(currentPlayerId);
  if (idx === -1 || idx === state.turnOrder.length - 1) return null;
  return state.turnOrder[idx + 1];
}
