/**
 * WebSocket Gateway for Khora Online.
 *
 * Framework-agnostic connection manager. Tracks player connections,
 * routes client messages, broadcasts filtered game state, and
 * monitors heartbeats.
 *
 * No ws, socket.io, or HTTP framework dependency — the actual
 * transport is injected via the `send` callback per connection.
 *
 * Requirements: 19.1, 19.4, 25.1, 25.2
 */

import type {
  ClientMessage,
  GameState,
  ServerMessage,
  Result,
  GameError,
} from '@khora/shared';
import { getStateForPlayer } from '../visibility';

/** Represents a single player's WebSocket connection. */
interface PlayerConnection {
  gameId: string;
  playerId: string;
  send: (msg: ServerMessage) => void;
  lastHeartbeat: number;
}

/** Callback invoked when a client message is received. */
export type MessageHandler = (
  gameId: string,
  playerId: string,
  message: ClientMessage,
) => Result<GameState, GameError> | void;

/** Callback invoked when a player's heartbeat expires. */
export type DisconnectHandler = (gameId: string, playerId: string) => void;

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000; // 30 seconds

/**
 * Manages WebSocket connections for all active games.
 *
 * - Tracks connections per game per player
 * - Broadcasts visibility-filtered state updates
 * - Routes incoming client messages to a handler
 * - Monitors heartbeats to detect stale connections
 */
export class WebSocketGateway {
  /** gameId → (playerId → connection) */
  private connections = new Map<string, Map<string, PlayerConnection>>();

  private messageHandler: MessageHandler | null = null;
  private disconnectHandler: DisconnectHandler | null = null;
  private heartbeatTimeoutMs: number;

  constructor(options?: { heartbeatTimeoutMs?: number }) {
    this.heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }

  /** Register the handler that processes incoming client messages. */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /** Register the handler called when a player's heartbeat expires. */
  onDisconnect(handler: DisconnectHandler): void {
    this.disconnectHandler = handler;
  }

  /**
   * Register a player connection for a game.
   *
   * Requirement 19.4: Maintain persistent connection for real-time updates.
   */
  addConnection(
    gameId: string,
    playerId: string,
    send: (msg: ServerMessage) => void,
  ): void {
    let gameConns = this.connections.get(gameId);
    if (!gameConns) {
      gameConns = new Map();
      this.connections.set(gameId, gameConns);
    }

    gameConns.set(playerId, {
      gameId,
      playerId,
      send,
      lastHeartbeat: Date.now(),
    });
  }

  /**
   * Remove a player connection from a game.
   * Cleans up the game entry if no connections remain.
   */
  removeConnection(gameId: string, playerId: string): void {
    const gameConns = this.connections.get(gameId);
    if (!gameConns) return;

    gameConns.delete(playerId);

    if (gameConns.size === 0) {
      this.connections.delete(gameId);
    }
  }

  /**
   * Broadcast visibility-filtered game state to every connected player in a game.
   *
   * Requirement 19.1: Broadcast updated state to all connected players.
   * Uses visibility filtering so each player only sees their own private info.
   */
  broadcastToGame(gameId: string, state: GameState): void {
    const gameConns = this.connections.get(gameId);
    if (!gameConns) return;

    for (const [playerId, conn] of gameConns) {
      const filtered = getStateForPlayer(state, playerId);
      const message: ServerMessage = {
        type: 'GAME_STATE_UPDATE',
        state: filtered.public,
        privateState: filtered.private,
      };
      conn.send(message);
    }
  }

  /**
   * Send a message to a specific player in a game.
   *
   * Requirement 25.1: Display visual notification to the player.
   * Requirement 25.2: Display pending action info to other players.
   */
  sendToPlayer(
    gameId: string,
    playerId: string,
    message: ServerMessage,
  ): void {
    const gameConns = this.connections.get(gameId);
    if (!gameConns) return;

    const conn = gameConns.get(playerId);
    if (!conn) return;

    conn.send(message);
  }

  /**
   * Handle an incoming client message from a player.
   *
   * HEARTBEAT messages update the player's heartbeat timestamp.
   * All other messages are forwarded to the registered message handler.
   */
  handleMessage(
    gameId: string,
    playerId: string,
    message: ClientMessage,
  ): void {
    // Update heartbeat on any message
    const gameConns = this.connections.get(gameId);
    const conn = gameConns?.get(playerId);
    if (conn) {
      conn.lastHeartbeat = Date.now();
    }

    // Heartbeat messages don't need further processing
    if (message.type === 'HEARTBEAT') {
      return;
    }

    // Route to message handler
    if (this.messageHandler) {
      const result = this.messageHandler(gameId, playerId, message);

      // If the handler returned an error result, send it back to the player
      if (result && !result.ok) {
        this.sendToPlayer(gameId, playerId, {
          type: 'ERROR',
          code: result.error.code,
          message: result.error.message,
        });
      }
    }
  }

  /**
   * Check all connections for expired heartbeats.
   * Calls the disconnect handler for any player whose heartbeat
   * has exceeded the timeout threshold.
   *
   * Returns the list of [gameId, playerId] pairs that were expired.
   */
  checkHeartbeats(): Array<{ gameId: string; playerId: string }> {
    const now = Date.now();
    const expired: Array<{ gameId: string; playerId: string }> = [];

    for (const [gameId, gameConns] of this.connections) {
      for (const [playerId, conn] of gameConns) {
        if (now - conn.lastHeartbeat > this.heartbeatTimeoutMs) {
          expired.push({ gameId, playerId });
        }
      }
    }

    // Notify disconnect handler and remove stale connections
    for (const { gameId, playerId } of expired) {
      this.removeConnection(gameId, playerId);
      if (this.disconnectHandler) {
        this.disconnectHandler(gameId, playerId);
      }
    }

    return expired;
  }

  /** Get the number of connected players for a game. */
  getConnectionCount(gameId: string): number {
    return this.connections.get(gameId)?.size ?? 0;
  }

  /** Check if a specific player is connected to a game. */
  isConnected(gameId: string, playerId: string): boolean {
    return this.connections.get(gameId)?.has(playerId) ?? false;
  }

  /** Get all connected player IDs for a game. */
  getConnectedPlayers(gameId: string): string[] {
    const gameConns = this.connections.get(gameId);
    if (!gameConns) return [];
    return Array.from(gameConns.keys());
  }

  /** Get the last heartbeat timestamp for a player. Returns 0 if not connected. */
  getLastHeartbeat(gameId: string, playerId: string): number {
    return this.connections.get(gameId)?.get(playerId)?.lastHeartbeat ?? 0;
  }
}
