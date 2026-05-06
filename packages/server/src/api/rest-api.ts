/**
 * REST API handler for Khora Online lobby and game management.
 *
 * Framework-agnostic: pure functions that take request data and return
 * response data. No Express, Koa, or HTTP framework dependency.
 */

import type { PlayerInfo, Result, GameState } from '@khora/shared';
import type { LobbyError } from '../lobby';
import { LobbyManager } from '../lobby';

/** Response from creating a lobby. */
export interface CreateLobbyResponse {
  lobbyId: string;
  hostPlayerId: string;
}

/** Response from joining a lobby. */
export interface JoinLobbyResponse {
  lobbyId: string;
  playerId: string;
  players: PlayerInfo[];
}

/** Response from starting a game. */
export interface StartGameResponse {
  gameId: string;
  players: PlayerInfo[];
}

/** A game listing for the browser. */
export interface GameListingItem {
  id: string;
  type: 'lobby' | 'game';
  hostName: string;
  players: { name: string; connected: boolean }[];
  maxPlayers: number;
  openSeats: number;
  currentPhase?: string;
  roundNumber?: number;
}

/** Error shape returned by REST handlers. */
export interface RestApiError {
  code: string;
  message: string;
}

let gameCounter = 0;

function generateGameId(): string {
  gameCounter += 1;
  return `game-${gameCounter}-${Date.now().toString(36)}`;
}

/**
 * Handles REST API requests for lobby and game management.
 * Delegates to LobbyManager for lobby operations.
 */
export class RestApiHandler {
  constructor(private readonly lobbyManager: LobbyManager) {}

  /**
   * Create a new lobby.
   * POST /api/lobbies
   */
  createLobby(hostPlayerName: string): Result<CreateLobbyResponse, RestApiError> {
    if (!hostPlayerName || hostPlayerName.trim().length === 0) {
      return {
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'hostPlayerName is required.' },
      };
    }

    const lobby = this.lobbyManager.createLobby(hostPlayerName.trim());

    return {
      ok: true,
      value: {
        lobbyId: lobby.lobbyId,
        hostPlayerId: lobby.hostPlayerId,
      },
    };
  }

  /**
   * Join an existing lobby by its ID.
   * POST /api/lobbies/:lobbyId/join
   */
  joinLobby(
    lobbyId: string,
    playerName: string,
  ): Result<JoinLobbyResponse, RestApiError> {
    if (!lobbyId || lobbyId.trim().length === 0) {
      return {
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'lobbyId is required.' },
      };
    }
    if (!playerName || playerName.trim().length === 0) {
      return {
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'playerName is required.' },
      };
    }

    const result = this.lobbyManager.joinLobby(lobbyId.trim(), playerName.trim());

    if (!result.ok) {
      return { ok: false, error: toLobbyRestError(result.error) };
    }

    return {
      ok: true,
      value: {
        lobbyId: result.value.lobby.lobbyId,
        playerId: result.value.playerId,
        players: [...result.value.lobby.players],
      },
    };
  }

  /**
   * Start a game from a lobby.
   * POST /api/lobbies/:lobbyId/start
   */
  startGame(
    lobbyId: string,
    requestingPlayerId: string,
  ): Result<StartGameResponse, RestApiError> {
    if (!lobbyId || lobbyId.trim().length === 0) {
      return {
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'lobbyId is required.' },
      };
    }
    if (!requestingPlayerId || requestingPlayerId.trim().length === 0) {
      return {
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'requestingPlayerId is required.' },
      };
    }

    const result = this.lobbyManager.startGame(lobbyId, requestingPlayerId);

    if (!result.ok) {
      return { ok: false, error: toLobbyRestError(result.error) };
    }

    return {
      ok: true,
      value: {
        gameId: generateGameId(),
        players: result.value,
      },
    };
  }

  /**
   * Build the game browser listing.
   * GET /api/games
   *
   * Returns open lobbies. In-progress disconnects are not open seats;
   * the original player may reconnect until their clock flags them.
   */
  listGames(activeGames: Map<string, GameState>, lobbyGameIds: Map<string, string>): GameListingItem[] {
    const listings: GameListingItem[] = [];

    // Open lobbies (not yet started)
    for (const lobby of this.lobbyManager.getOpenLobbies()) {
      listings.push({
        id: lobby.lobbyId,
        type: 'lobby',
        hostName: lobby.hostPlayerName,
        players: lobby.players.map(p => ({ name: p.playerName, connected: true })),
        maxPlayers: 4,
        openSeats: 4 - lobby.players.length,
      });
    }

    void activeGames;
    void lobbyGameIds;

    return listings;
  }

  /** Expose the underlying LobbyManager (for wiring with WebSocket gateway). */
  getLobbyManager(): LobbyManager {
    return this.lobbyManager;
  }
}

/** Maps LobbyError codes to REST-friendly error shapes. */
function toLobbyRestError(error: LobbyError): RestApiError {
  return { code: error.code, message: error.message };
}
