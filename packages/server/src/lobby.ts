/**
 * Lobby management for Khora Online.
 *
 * Handles lobby creation, player join/disconnect, and game start transitions.
 * Games are publicly listed — no invite codes needed.
 */

import type { PlayerInfo, Result } from '@khora/shared';

/** A lobby waiting room before a game begins. */
export interface Lobby {
  lobbyId: string;
  hostPlayerId: string;
  hostPlayerName: string;
  players: PlayerInfo[];
  started: boolean;
  recordStats: boolean;
  createdAt: number;
}

/** Error codes specific to lobby operations. */
export type LobbyErrorCode =
  | 'LOBBY_FULL'
  | 'LOBBY_NOT_FOUND'
  | 'INSUFFICIENT_PLAYERS'
  | 'NOT_HOST'
  | 'LOBBY_ALREADY_STARTED'
  | 'PLAYER_NOT_FOUND';

export interface LobbyError {
  code: LobbyErrorCode;
  message: string;
}

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;

let lobbyCounter = 0;

function generateId(): string {
  lobbyCounter += 1;
  return `lobby-${lobbyCounter}-${Date.now().toString(36)}`;
}

let playerCounter = 0;

export function generatePlayerId(): string {
  playerCounter += 1;
  return `player-${playerCounter}-${Date.now().toString(36)}`;
}

/**
 * Manages multiple lobbies for Khora Online.
 */
export class LobbyManager {
  private lobbies = new Map<string, Lobby>();

  /** Creates a new lobby with the given host player name. */
  createLobby(hostPlayerName: string): Lobby {
    const lobbyId = generateId();
    const hostPlayerId = generatePlayerId();

    const lobby: Lobby = {
      lobbyId,
      hostPlayerId,
      hostPlayerName,
      players: [{ playerId: hostPlayerId, playerName: hostPlayerName }],
      started: false,
      recordStats: true,
      createdAt: Date.now(),
    };

    this.lobbies.set(lobbyId, lobby);
    return lobby;
  }

  /** Joins a lobby by its ID. Returns the updated lobby or an error. */
  joinLobby(lobbyId: string, playerName: string): Result<{ lobby: Lobby; playerId: string }, LobbyError> {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) {
      return { ok: false, error: { code: 'LOBBY_NOT_FOUND', message: `No lobby found with id "${lobbyId}".` } };
    }

    if (lobby.started) {
      return { ok: false, error: { code: 'LOBBY_ALREADY_STARTED', message: 'This lobby has already started a game.' } };
    }

    if (lobby.players.length >= MAX_PLAYERS) {
      return { ok: false, error: { code: 'LOBBY_FULL', message: 'Lobby is full (maximum 4 players).' } };
    }

    const playerId = generatePlayerId();
    lobby.players.push({ playerId, playerName });

    return { ok: true, value: { lobby, playerId } };
  }

  /** Removes a player from a lobby. Returns remaining players or an error. */
  disconnectPlayer(lobbyId: string, playerId: string): Result<PlayerInfo[], LobbyError> {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) {
      return { ok: false, error: { code: 'LOBBY_NOT_FOUND', message: `No lobby found with id "${lobbyId}".` } };
    }

    const idx = lobby.players.findIndex(p => p.playerId === playerId);
    if (idx === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: `Player "${playerId}" not found in lobby.` } };
    }

    lobby.players.splice(idx, 1);

    // If the lobby is now empty, clean it up
    if (lobby.players.length === 0) {
      this.lobbies.delete(lobbyId);
    }

    return { ok: true, value: lobby.players };
  }

  /** Starts the game for a lobby. Only the host can start, and 2–4 players are required. */
  startGame(lobbyId: string, requestingPlayerId: string): Result<PlayerInfo[], LobbyError> {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) {
      return { ok: false, error: { code: 'LOBBY_NOT_FOUND', message: `No lobby found with id "${lobbyId}".` } };
    }

    if (lobby.started) {
      return { ok: false, error: { code: 'LOBBY_ALREADY_STARTED', message: 'This lobby has already started a game.' } };
    }

    if (requestingPlayerId !== lobby.hostPlayerId) {
      return { ok: false, error: { code: 'NOT_HOST', message: 'Only the host can start the game.' } };
    }

    if (lobby.players.length < MIN_PLAYERS) {
      return { ok: false, error: { code: 'INSUFFICIENT_PLAYERS', message: `Need at least ${MIN_PLAYERS} players to start (currently ${lobby.players.length}).` } };
    }

    lobby.started = true;
    return { ok: true, value: [...lobby.players] };
  }

  /** Returns the current player list for a lobby. */
  getPlayers(lobbyId: string): Result<PlayerInfo[], LobbyError> {
    const lobby = this.lobbies.get(lobbyId);
    if (!lobby) {
      return { ok: false, error: { code: 'LOBBY_NOT_FOUND', message: `No lobby found with id "${lobbyId}".` } };
    }
    return { ok: true, value: [...lobby.players] };
  }

  /** Returns a lobby by its ID. */
  getLobby(lobbyId: string): Lobby | undefined {
    return this.lobbies.get(lobbyId);
  }

  /** Returns all lobbies that haven't started yet (for the game browser). */
  getOpenLobbies(): Lobby[] {
    return Array.from(this.lobbies.values()).filter(l => !l.started);
  }
}
