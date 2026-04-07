/**
 * Disconnection and reconnection handling for Khora Online.
 *
 * Manages player disconnect/reconnect lifecycle with a 120-second
 * reconnection window. During the window the game continues as if the
 * player is still present (decisions auto-resolve on timeout). After
 * the window expires the player is removed from the game completely.
 */

import type { GameState } from '@khora/shared';
import type { DisconnectionInfo } from '@khora/shared';

const DISCONNECT_WINDOW_MS = 120_000; // 120 seconds (2 minutes)

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

/**
 * Completely remove a player from the game after their reconnection
 * window has expired. Strips them from players, turnOrder,
 * pendingDecisions, and disconnectedPlayers. Achievements they claimed
 * are kept so they remain unavailable to other players.
 */
export function removePlayer(state: GameState, playerId: string): GameState {
  const players = state.players.filter(p => p.playerId !== playerId);
  const turnOrder = state.turnOrder.filter(id => id !== playerId);
  const pendingDecisions = state.pendingDecisions.filter(d => d.playerId !== playerId);

  const disconnectedPlayers = new Map(state.disconnectedPlayers);
  disconnectedPlayers.delete(playerId);

  // Update startPlayerId if the removed player was the start player
  const startPlayerId = state.startPlayerId === playerId
    ? (turnOrder[0] ?? '')
    : state.startPlayerId;

  return {
    ...state,
    players,
    turnOrder,
    pendingDecisions,
    disconnectedPlayers,
    startPlayerId,
    updatedAt: Date.now(),
  };
}
