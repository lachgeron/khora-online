import { describe, it, expect, beforeEach } from 'vitest';
import { LobbyManager } from '../lobby';
import { RestApiHandler } from './rest-api';

describe('RestApiHandler', () => {
  let handler: RestApiHandler;
  let lobbyManager: LobbyManager;

  beforeEach(() => {
    lobbyManager = new LobbyManager();
    handler = new RestApiHandler(lobbyManager);
  });

  describe('createLobby', () => {
    it('creates a lobby and returns lobbyId and hostPlayerId', () => {
      const result = handler.createLobby('Alice');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.lobbyId).toBeTruthy();
      expect(result.value.hostPlayerId).toBeTruthy();
    });

    it('rejects empty hostPlayerName', () => {
      const result = handler.createLobby('');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUEST');
      }
    });

    it('trims whitespace from hostPlayerName', () => {
      const result = handler.createLobby('  Alice  ');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const lobby = lobbyManager.getLobby(result.value.lobbyId);
      expect(lobby?.players[0].playerName).toBe('Alice');
    });

    it('creates lobby in the underlying LobbyManager', () => {
      const result = handler.createLobby('Alice');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const lobby = lobbyManager.getLobby(result.value.lobbyId);
      expect(lobby).toBeDefined();
      expect(lobby!.players).toHaveLength(1);
    });
  });

  describe('joinLobby', () => {
    it('joins a lobby by ID and returns player info', () => {
      const createResult = handler.createLobby('Alice');
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const joinResult = handler.joinLobby(createResult.value.lobbyId, 'Bob');
      expect(joinResult.ok).toBe(true);
      if (!joinResult.ok) return;

      expect(joinResult.value.lobbyId).toBe(createResult.value.lobbyId);
      expect(joinResult.value.playerId).toBeTruthy();
      expect(joinResult.value.players).toHaveLength(2);
      expect(joinResult.value.players.map(p => p.playerName)).toContain('Bob');
    });

    it('rejects empty lobbyId', () => {
      const result = handler.joinLobby('', 'Bob');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUEST');
      }
    });

    it('rejects empty playerName', () => {
      const createResult = handler.createLobby('Alice');
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = handler.joinLobby(createResult.value.lobbyId, '');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUEST');
      }
    });

    it('returns error for non-existent lobby', () => {
      const result = handler.joinLobby('fake-id', 'Bob');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOBBY_NOT_FOUND');
      }
    });

    it('rejects join when lobby is full', () => {
      const createResult = handler.createLobby('Alice');
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const id = createResult.value.lobbyId;
      handler.joinLobby(id, 'Bob');
      handler.joinLobby(id, 'Carol');
      handler.joinLobby(id, 'Dave');

      const result = handler.joinLobby(id, 'Eve');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOBBY_FULL');
      }
    });
  });

  describe('startGame', () => {
    it('starts a game with 2+ players and returns gameId', () => {
      const createResult = handler.createLobby('Alice');
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      handler.joinLobby(createResult.value.lobbyId, 'Bob');

      const startResult = handler.startGame(
        createResult.value.lobbyId,
        createResult.value.hostPlayerId,
      );
      expect(startResult.ok).toBe(true);
      if (!startResult.ok) return;

      expect(startResult.value.gameId).toBeTruthy();
      expect(startResult.value.gameId).toMatch(/^game-/);
      expect(startResult.value.players).toHaveLength(2);
    });

    it('rejects start with fewer than 2 players', () => {
      const createResult = handler.createLobby('Alice');
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const result = handler.startGame(
        createResult.value.lobbyId,
        createResult.value.hostPlayerId,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSUFFICIENT_PLAYERS');
      }
    });

    it('rejects start from non-host player', () => {
      const createResult = handler.createLobby('Alice');
      expect(createResult.ok).toBe(true);
      if (!createResult.ok) return;

      const joinResult = handler.joinLobby(createResult.value.lobbyId, 'Bob');
      expect(joinResult.ok).toBe(true);
      if (!joinResult.ok) return;

      const result = handler.startGame(
        createResult.value.lobbyId,
        joinResult.value.playerId,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_HOST');
      }
    });

    it('rejects empty lobbyId', () => {
      const result = handler.startGame('', 'player-1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUEST');
      }
    });

    it('rejects empty requestingPlayerId', () => {
      const result = handler.startGame('lobby-1', '');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_REQUEST');
      }
    });

    it('returns error for non-existent lobby', () => {
      const result = handler.startGame('fake-lobby', 'fake-player');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOBBY_NOT_FOUND');
      }
    });

    it('generates unique gameIds for different starts', () => {
      const create1 = handler.createLobby('Alice');
      const create2 = handler.createLobby('Charlie');
      expect(create1.ok && create2.ok).toBe(true);
      if (!create1.ok || !create2.ok) return;

      handler.joinLobby(create1.value.lobbyId, 'Bob');
      handler.joinLobby(create2.value.lobbyId, 'Dave');

      const start1 = handler.startGame(create1.value.lobbyId, create1.value.hostPlayerId);
      const start2 = handler.startGame(create2.value.lobbyId, create2.value.hostPlayerId);

      expect(start1.ok && start2.ok).toBe(true);
      if (!start1.ok || !start2.ok) return;

      expect(start1.value.gameId).not.toBe(start2.value.gameId);
    });
  });

  describe('listGames', () => {
    it('returns open lobbies', () => {
      handler.createLobby('Alice');
      handler.createLobby('Bob');

      const listings = handler.listGames(new Map(), new Map());
      expect(listings).toHaveLength(2);
      expect(listings[0].type).toBe('lobby');
      expect(listings[0].hostName).toBe('Alice');
    });

    it('excludes started lobbies', () => {
      const create = handler.createLobby('Alice');
      if (!create.ok) return;
      handler.joinLobby(create.value.lobbyId, 'Bob');
      handler.startGame(create.value.lobbyId, create.value.hostPlayerId);

      const listings = handler.listGames(new Map(), new Map());
      expect(listings).toHaveLength(0);
    });
  });

  describe('getLobbyManager', () => {
    it('returns the underlying LobbyManager instance', () => {
      expect(handler.getLobbyManager()).toBe(lobbyManager);
    });
  });
});
