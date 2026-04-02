import { describe, it, expect, beforeEach } from 'vitest';
import { LobbyManager } from './lobby';

describe('LobbyManager', () => {
  let manager: LobbyManager;

  beforeEach(() => {
    manager = new LobbyManager();
  });

  describe('createLobby', () => {
    it('sets the creator as host and first player', () => {
      const lobby = manager.createLobby('Alice');
      expect(lobby.hostPlayerId).toBe(lobby.players[0].playerId);
      expect(lobby.players[0].playerName).toBe('Alice');
      expect(lobby.players).toHaveLength(1);
    });

    it('creates lobby in non-started state', () => {
      const lobby = manager.createLobby('Alice');
      expect(lobby.started).toBe(false);
    });

    it('stores host player name', () => {
      const lobby = manager.createLobby('Alice');
      expect(lobby.hostPlayerName).toBe('Alice');
    });
  });

  describe('joinLobby', () => {
    it('adds a player to the lobby by lobby ID', () => {
      const lobby = manager.createLobby('Alice');
      const result = manager.joinLobby(lobby.lobbyId, 'Bob');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.lobby.players).toHaveLength(2);
        expect(result.value.lobby.players[1].playerName).toBe('Bob');
      }
    });

    it('returns error for non-existent lobby', () => {
      const result = manager.joinLobby('fake-id', 'Bob');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOBBY_NOT_FOUND');
      }
    });

    it('rejects join when lobby is full (4 players)', () => {
      const lobby = manager.createLobby('Alice');
      manager.joinLobby(lobby.lobbyId, 'Bob');
      manager.joinLobby(lobby.lobbyId, 'Carol');
      manager.joinLobby(lobby.lobbyId, 'Dave');

      const result = manager.joinLobby(lobby.lobbyId, 'Eve');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOBBY_FULL');
      }
    });

    it('rejects join when lobby has already started', () => {
      const lobby = manager.createLobby('Alice');
      manager.joinLobby(lobby.lobbyId, 'Bob');
      manager.startGame(lobby.lobbyId, lobby.hostPlayerId);

      const result = manager.joinLobby(lobby.lobbyId, 'Carol');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOBBY_ALREADY_STARTED');
      }
    });

    it('allows exactly 4 players to join', () => {
      const lobby = manager.createLobby('Alice');
      const r2 = manager.joinLobby(lobby.lobbyId, 'Bob');
      const r3 = manager.joinLobby(lobby.lobbyId, 'Carol');
      const r4 = manager.joinLobby(lobby.lobbyId, 'Dave');

      expect(r2.ok).toBe(true);
      expect(r3.ok).toBe(true);
      expect(r4.ok).toBe(true);

      const players = manager.getPlayers(lobby.lobbyId);
      if (players.ok) {
        expect(players.value).toHaveLength(4);
      }
    });
  });

  describe('disconnectPlayer', () => {
    it('removes a player from the lobby', () => {
      const lobby = manager.createLobby('Alice');
      const joinResult = manager.joinLobby(lobby.lobbyId, 'Bob');
      expect(joinResult.ok).toBe(true);
      if (!joinResult.ok) return;

      const result = manager.disconnectPlayer(lobby.lobbyId, joinResult.value.playerId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0].playerName).toBe('Alice');
      }
    });

    it('returns error for non-existent lobby', () => {
      const result = manager.disconnectPlayer('fake-id', 'fake-player');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOBBY_NOT_FOUND');
      }
    });

    it('returns error for non-existent player', () => {
      const lobby = manager.createLobby('Alice');
      const result = manager.disconnectPlayer(lobby.lobbyId, 'fake-player');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLAYER_NOT_FOUND');
      }
    });

    it('cleans up lobby when last player disconnects', () => {
      const lobby = manager.createLobby('Alice');
      manager.disconnectPlayer(lobby.lobbyId, lobby.hostPlayerId);
      expect(manager.getLobby(lobby.lobbyId)).toBeUndefined();
    });

    it('decreases player count by one', () => {
      const lobby = manager.createLobby('Alice');
      manager.joinLobby(lobby.lobbyId, 'Bob');
      manager.joinLobby(lobby.lobbyId, 'Carol');

      const playersResult = manager.getPlayers(lobby.lobbyId);
      expect(playersResult.ok).toBe(true);
      if (!playersResult.ok) return;
      const countBefore = playersResult.value.length;

      const joinResult = manager.joinLobby(lobby.lobbyId, 'Dave');
      if (!joinResult.ok) return;

      manager.disconnectPlayer(lobby.lobbyId, joinResult.value.playerId);

      const afterResult = manager.getPlayers(lobby.lobbyId);
      expect(afterResult.ok).toBe(true);
      if (afterResult.ok) {
        expect(afterResult.value.length).toBe(countBefore);
      }
    });
  });

  describe('startGame', () => {
    it('starts game with 2 players', () => {
      const lobby = manager.createLobby('Alice');
      manager.joinLobby(lobby.lobbyId, 'Bob');

      const result = manager.startGame(lobby.lobbyId, lobby.hostPlayerId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.map(p => p.playerName)).toEqual(['Alice', 'Bob']);
      }
    });

    it('starts game with 4 players', () => {
      const lobby = manager.createLobby('Alice');
      manager.joinLobby(lobby.lobbyId, 'Bob');
      manager.joinLobby(lobby.lobbyId, 'Carol');
      manager.joinLobby(lobby.lobbyId, 'Dave');

      const result = manager.startGame(lobby.lobbyId, lobby.hostPlayerId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(4);
      }
    });

    it('rejects start with fewer than 2 players', () => {
      const lobby = manager.createLobby('Alice');
      const result = manager.startGame(lobby.lobbyId, lobby.hostPlayerId);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSUFFICIENT_PLAYERS');
      }
    });

    it('rejects start from non-host player', () => {
      const lobby = manager.createLobby('Alice');
      const joinResult = manager.joinLobby(lobby.lobbyId, 'Bob');
      expect(joinResult.ok).toBe(true);
      if (!joinResult.ok) return;

      const result = manager.startGame(lobby.lobbyId, joinResult.value.playerId);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_HOST');
      }
    });

    it('rejects start for non-existent lobby', () => {
      const result = manager.startGame('fake-id', 'fake-player');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOBBY_NOT_FOUND');
      }
    });

    it('rejects double start', () => {
      const lobby = manager.createLobby('Alice');
      manager.joinLobby(lobby.lobbyId, 'Bob');
      manager.startGame(lobby.lobbyId, lobby.hostPlayerId);

      const result = manager.startGame(lobby.lobbyId, lobby.hostPlayerId);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOBBY_ALREADY_STARTED');
      }
    });

    it('marks lobby as started', () => {
      const lobby = manager.createLobby('Alice');
      manager.joinLobby(lobby.lobbyId, 'Bob');
      manager.startGame(lobby.lobbyId, lobby.hostPlayerId);

      const updated = manager.getLobby(lobby.lobbyId);
      expect(updated?.started).toBe(true);
    });

    it('returns a copy of the player list (not a reference)', () => {
      const lobby = manager.createLobby('Alice');
      manager.joinLobby(lobby.lobbyId, 'Bob');

      const result = manager.startGame(lobby.lobbyId, lobby.hostPlayerId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        result.value.push({ playerId: 'hacker', playerName: 'Hacker' });
        const players = manager.getPlayers(lobby.lobbyId);
        if (players.ok) {
          expect(players.value).toHaveLength(2);
        }
      }
    });
  });

  describe('getPlayers', () => {
    it('returns current player list', () => {
      const lobby = manager.createLobby('Alice');
      manager.joinLobby(lobby.lobbyId, 'Bob');

      const result = manager.getPlayers(lobby.lobbyId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.map(p => p.playerName)).toEqual(['Alice', 'Bob']);
      }
    });

    it('returns error for non-existent lobby', () => {
      const result = manager.getPlayers('fake-id');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('LOBBY_NOT_FOUND');
      }
    });
  });

  describe('getOpenLobbies', () => {
    it('returns only non-started lobbies', () => {
      const lobby1 = manager.createLobby('Alice');
      manager.createLobby('Bob');
      manager.joinLobby(lobby1.lobbyId, 'Carol');
      manager.startGame(lobby1.lobbyId, lobby1.hostPlayerId);

      const open = manager.getOpenLobbies();
      expect(open).toHaveLength(1);
      expect(open[0].hostPlayerName).toBe('Bob');
    });

    it('returns empty array when no lobbies exist', () => {
      expect(manager.getOpenLobbies()).toHaveLength(0);
    });
  });
});
