import { describe, it, expect } from 'vitest';
import { serializeGameState, deserializeGameState } from './serialization';
import { makeTestPlayer, makeTestGameState, makeTestAchievement } from './test-helpers';
import type { GameState } from '@khora/shared';

function makeTestState(overrides: Partial<GameState> = {}): GameState {
  return makeTestGameState({
    roundNumber: 3,
    currentPhase: 'ACTIONS',
    players: [
      makeTestPlayer({
        playerId: 'p1',
        playerName: 'Alice',
        cityId: 'city-1',
        coins: 10,
        knowledgeTokens: [],
        troopTrack: 3,
        citizenTrack: 5,
        economyTrack: 4,
        cultureTrack: 2,
        militaryTrack: 1,
        diceRoll: [3, 5],
        actionSlots: [null, null, null],
        gloryTrack: 7,
        victoryPoints: 12,
        isConnected: true,
      }),
    ],
    claimedAchievements: new Map([
      ['p1', [makeTestAchievement('ach-1', {
        name: 'First',
        condition: { type: 'CUSTOM', evaluate: () => true, description: 'test' },
      })]],
    ]),
    disconnectedPlayers: new Map([
      ['p2', { disconnectedAt: 1000, expiresAt: 301000 }],
    ]),
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    ...overrides,
  });
}

describe('serialization', () => {
  describe('serializeGameState', () => {
    it('produces valid JSON', () => {
      const state = makeTestState();
      const json = serializeGameState(state);
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('converts Maps to arrays', () => {
      const state = makeTestState();
      const json = serializeGameState(state);
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed.claimedAchievements)).toBe(true);
      expect(Array.isArray(parsed.disconnectedPlayers)).toBe(true);
    });
  });

  describe('deserializeGameState', () => {
    it('reconstructs Maps from arrays', () => {
      const state = makeTestState();
      const json = serializeGameState(state);
      const restored = deserializeGameState(json);
      expect(restored.claimedAchievements).toBeInstanceOf(Map);
      expect(restored.disconnectedPlayers).toBeInstanceOf(Map);
    });
  });

  describe('round-trip', () => {
    it('preserves scalar fields', () => {
      const state = makeTestState();
      const restored = deserializeGameState(serializeGameState(state));
      expect(restored.gameId).toBe(state.gameId);
      expect(restored.roundNumber).toBe(state.roundNumber);
      expect(restored.currentPhase).toBe(state.currentPhase);
      expect(restored.createdAt).toBe(state.createdAt);
      expect(restored.updatedAt).toBe(state.updatedAt);
    });

    it('preserves player state', () => {
      const state = makeTestState();
      const restored = deserializeGameState(serializeGameState(state));
      expect(restored.players).toHaveLength(1);
      const p = restored.players[0];
      expect(p.playerId).toBe('p1');
      expect(p.coins).toBe(10);
      expect(p.diceRoll).toEqual([3, 5]);
    });

    it('preserves claimedAchievements Map', () => {
      const state = makeTestState();
      const restored = deserializeGameState(serializeGameState(state));
      expect(restored.claimedAchievements.size).toBe(1);
      const tokens = restored.claimedAchievements.get('p1');
      expect(tokens).toHaveLength(1);
      expect(tokens![0].id).toBe('ach-1');
    });

    it('preserves disconnectedPlayers Map', () => {
      const state = makeTestState();
      const restored = deserializeGameState(serializeGameState(state));
      expect(restored.disconnectedPlayers.size).toBe(1);
      const info = restored.disconnectedPlayers.get('p2');
      expect(info).toEqual({ disconnectedAt: 1000, expiresAt: 301000 });
    });

    it('handles empty Maps', () => {
      const state = makeTestState({
        claimedAchievements: new Map(),
        disconnectedPlayers: new Map(),
      });
      const restored = deserializeGameState(serializeGameState(state));
      expect(restored.claimedAchievements.size).toBe(0);
      expect(restored.disconnectedPlayers.size).toBe(0);
    });

    it('handles null currentEvent', () => {
      const state = makeTestState({ currentEvent: null });
      const restored = deserializeGameState(serializeGameState(state));
      expect(restored.currentEvent).toBeNull();
    });
  });
});
