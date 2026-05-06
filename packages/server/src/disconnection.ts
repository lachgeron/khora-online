/**
 * Disconnection and reconnection handling for Khora Online.
 *
 * Manages player disconnect/reconnect lifecycle. A disconnect only
 * affects connection status; turn timers and time bank exhaustion decide
 * whether the player flags and forfeits.
 */

import type { GameState } from '@khora/shared';
import type { DisconnectionInfo } from '@khora/shared';

/**
 * Handle a player disconnecting.
 * Marks the player as disconnected without changing their pending turns.
 */
export function handleDisconnect(state: GameState, playerId: string): GameState {
  const now = Date.now();
  const info: DisconnectionInfo = {
    disconnectedAt: now,
  };

  const newDisconnected = new Map(state.disconnectedPlayers);
  newDisconnected.set(playerId, info);

  const players = state.players.map((p) =>
    p.playerId === playerId ? { ...p, isConnected: false } : p,
  );

  return { ...state, players, disconnectedPlayers: newDisconnected };
}

/**
 * Handle a player reconnecting.
 * Restores the player's connection status and removes DisconnectionInfo.
 */
export function handleReconnect(state: GameState, playerId: string): GameState {
  const newDisconnected = new Map(state.disconnectedPlayers);
  newDisconnected.delete(playerId);

  const players = state.players.map((p) =>
    p.playerId === playerId ? { ...p, isConnected: true } : p,
  );

  return { ...state, players, disconnectedPlayers: newDisconnected };
}
/**
 * Get the list of currently disconnected player IDs.
 */
export function getDisconnectedPlayers(state: GameState): string[] {
  return Array.from(state.disconnectedPlayers.keys());
}
