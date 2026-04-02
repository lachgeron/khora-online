import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  handleDisconnect,
  handleReconnect,
  isAbandoned,
  getDisconnectedPlayers,
  autoResolveForDisconnected,
} from './disconnection';
import { makeTestPlayer, makeTestGameState } from './test-helpers';
import type { GameState, PlayerState } from '@khora/shared';

function makePlayer(id: string, connected = true): PlayerState {
  return makeTestPlayer({
    playerId: id,
    playerName: `Player ${id}`,
    cityId: `city-${id}`,
    coins: 10,
    knowledgeTokens: [],
    troopTrack: 3,
    citizenTrack: 5,
    economyTrack: 2,
    cultureTrack: 1,
    militaryTrack: 1,
    diceRoll: null,
    actionSlots: [null, null, null],
    gloryTrack: 0,
    victoryPoints: 0,
    isConnected: connected,
  });
}

function makeTestState(players: PlayerState[]): GameState {
  return makeTestGameState({
    players,
    currentPhase: 'ACTIONS',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  });
}

describe('disconnection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('handleDisconnect', () => {
    it('marks player as disconnected', () => {
      const state = makeTestState([makePlayer('p1'), makePlayer('p2')]);
      const updated = handleDisconnect(state, 'p1');
      expect(updated.players.find((p) => p.playerId === 'p1')!.isConnected).toBe(false);
      expect(updated.players.find((p) => p.playerId === 'p2')!.isConnected).toBe(true);
    });

    it('stores DisconnectionInfo with 300s expiry', () => {
      const state = makeTestState([makePlayer('p1')]);
      const updated = handleDisconnect(state, 'p1');
      const info = updated.disconnectedPlayers.get('p1');
      expect(info).toBeDefined();
      expect(info!.disconnectedAt).toBe(1700000000000);
      expect(info!.expiresAt).toBe(1700000000000 + 300_000);
    });

    it('does not mutate original state', () => {
      const state = makeTestState([makePlayer('p1')]);
      handleDisconnect(state, 'p1');
      expect(state.disconnectedPlayers.size).toBe(0);
      expect(state.players[0].isConnected).toBe(true);
    });
  });

  describe('handleReconnect', () => {
    it('restores player connection', () => {
      let state = makeTestState([makePlayer('p1')]);
      state = handleDisconnect(state, 'p1');
      const updated = handleReconnect(state, 'p1');
      expect(updated.players.find((p) => p.playerId === 'p1')!.isConnected).toBe(true);
      expect(updated.disconnectedPlayers.has('p1')).toBe(false);
    });

    it('does not affect other players', () => {
      let state = makeTestState([makePlayer('p1'), makePlayer('p2')]);
      state = handleDisconnect(state, 'p1');
      state = handleDisconnect(state, 'p2');
      const updated = handleReconnect(state, 'p1');
      expect(updated.disconnectedPlayers.has('p2')).toBe(true);
      expect(updated.players.find((p) => p.playerId === 'p2')!.isConnected).toBe(false);
    });
  });

  describe('isAbandoned', () => {
    it('returns false when player is not disconnected', () => {
      const state = makeTestState([makePlayer('p1')]);
      expect(isAbandoned(state, 'p1')).toBe(false);
    });

    it('returns false within 300s window', () => {
      let state = makeTestState([makePlayer('p1')]);
      state = handleDisconnect(state, 'p1');
      vi.advanceTimersByTime(299_999);
      expect(isAbandoned(state, 'p1')).toBe(false);
    });

    it('returns true after 300s window expires', () => {
      let state = makeTestState([makePlayer('p1')]);
      state = handleDisconnect(state, 'p1');
      vi.advanceTimersByTime(300_000);
      expect(isAbandoned(state, 'p1')).toBe(true);
    });
  });

  describe('getDisconnectedPlayers', () => {
    it('returns empty array when no disconnections', () => {
      const state = makeTestState([makePlayer('p1')]);
      expect(getDisconnectedPlayers(state)).toEqual([]);
    });

    it('returns disconnected player IDs', () => {
      let state = makeTestState([makePlayer('p1'), makePlayer('p2'), makePlayer('p3')]);
      state = handleDisconnect(state, 'p1');
      state = handleDisconnect(state, 'p3');
      const ids = getDisconnectedPlayers(state);
      expect(ids).toContain('p1');
      expect(ids).toContain('p3');
      expect(ids).not.toContain('p2');
    });
  });

  describe('autoResolveForDisconnected', () => {
    it('removes pending decisions for the player', () => {
      const state = makeTestState([makePlayer('p1')]);
      state.pendingDecisions = [
        { playerId: 'p1', decisionType: 'RESOLVE_ACTION', timeoutAt: 0, options: {} },
        { playerId: 'p2', decisionType: 'ASSIGN_DICE', timeoutAt: 0, options: {} },
      ];
      const updated = autoResolveForDisconnected(state, 'p1');
      expect(updated.pendingDecisions).toHaveLength(1);
      expect(updated.pendingDecisions[0].playerId).toBe('p2');
    });

    it('marks unresolved action slots as resolved', () => {
      const player = makePlayer('p1');
      player.actionSlots = [
        { actionType: 'TRADE', assignedDie: 3, resolved: false, citizenCost: 0 },
        { actionType: 'MILITARY', assignedDie: 5, resolved: false, citizenCost: 0 },
        null,
      ];
      const state = makeTestState([player]);
      const updated = autoResolveForDisconnected(state, 'p1');
      const p = updated.players.find((p) => p.playerId === 'p1')!;
      expect(p.actionSlots[0]!.resolved).toBe(true);
      expect(p.actionSlots[1]!.resolved).toBe(true);
    });

    it('does not affect already resolved slots', () => {
      const player = makePlayer('p1');
      player.actionSlots = [
        { actionType: 'TRADE', assignedDie: 3, resolved: true, citizenCost: 1 },
        null,
        null,
      ];
      const state = makeTestState([player]);
      const updated = autoResolveForDisconnected(state, 'p1');
      const p = updated.players.find((p) => p.playerId === 'p1')!;
      expect(p.actionSlots[0]!.resolved).toBe(true);
      expect(p.actionSlots[0]!.citizenCost).toBe(1);
      expect(p.actionSlots[1]).toBeNull();
    });
  });
});
