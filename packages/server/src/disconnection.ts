/**
 * Disconnection and reconnection handling for Khora Online.
 *
 * Manages player disconnect/reconnect lifecycle with a 300-second
 * reconnection window. Auto-resolves pending decisions for disconnected
 * players by skipping optional actions and making no purchases.
 */

import type { GameState } from '@khora/shared';
import type { DisconnectionInfo } from '@khora/shared';

const DISCONNECT_WINDOW_MS = 300_000; // 300 seconds

/**
 * Handle a player disconnecting.
 * Marks the player as disconnected and stores DisconnectionInfo with 300s expiry.
 */
export function handleDisconnect(state: GameState, playerId: string): GameState {
  const now = Date.now();
  const info: DisconnectionInfo = {
    disconnectedAt: now,
    expiresAt: now + DISCONNECT_WINDOW_MS,
  };

  const newDisconnected = new Map(state.disconnectedPlayers);
  newDisconnected.set(playerId, info);

  const players = state.players.map((p) =>
    p.playerId === playerId ? { ...p, isConnected: false } : p,
  );

  return { ...state, players, disconnectedPlayers: newDisconnected };
}

/**
 * Handle a player reconnecting within the 300s window.
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
 * Check if a player's 300-second reconnection window has expired.
 */
export function isAbandoned(state: GameState, playerId: string): boolean {
  const info = state.disconnectedPlayers.get(playerId);
  if (!info) return false;
  return Date.now() >= info.expiresAt;
}

/**
 * Get the list of currently disconnected player IDs.
 */
export function getDisconnectedPlayers(state: GameState): string[] {
  return Array.from(state.disconnectedPlayers.keys());
}

/**
 * Auto-resolve pending decisions for a disconnected player.
 * Default behavior: skip optional actions, make no purchases.
 * Removes any pending decisions for the player.
 */
export function autoResolveForDisconnected(
  state: GameState,
  playerId: string,
): GameState {
  // Remove pending decisions for this player (skip them)
  const pendingDecisions = state.pendingDecisions.filter(
    (d) => d.playerId !== playerId,
  );

  // Mark action slots as resolved (forfeit unresolved actions)
  const players = state.players.map((p) => {
    if (p.playerId !== playerId) return p;
    const actionSlots = p.actionSlots.map((slot) => {
      if (!slot || slot.resolved) return slot;
      return { ...slot, resolved: true };
    }) as typeof p.actionSlots;
    return { ...p, actionSlots };
  });

  return { ...state, players, pendingDecisions };
}
