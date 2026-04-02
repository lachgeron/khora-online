import { describe, it, expect } from 'vitest';
import { PhilosophyResolver } from './philosophy-resolver';
import { makeTestPlayer, makeTestGameState } from '../test-helpers';

describe('PhilosophyResolver', () => {
  const resolver = new PhilosophyResolver();

  describe('metadata', () => {
    it('has actionNumber 0', () => {
      expect(resolver.actionNumber).toBe(0);
    });

    it('has actionType PHILOSOPHY', () => {
      expect(resolver.actionType).toBe('PHILOSOPHY');
    });
  });

  describe('canPerform', () => {
    it('always returns canPerform true for any die value 1-6', () => {
      const state = makeTestGameState();
      for (let die = 1; die <= 6; die++) {
        const result = resolver.canPerform(state, 'player-1', die);
        expect(result.canPerform).toBe(true);
      }
    });

    it('returns citizenCost 0 for all valid die values', () => {
      const state = makeTestGameState();
      for (let die = 1; die <= 6; die++) {
        const result = resolver.canPerform(state, 'player-1', die);
        expect(result.citizenCost).toBe(0);
      }
    });
  });

  describe('resolve', () => {
    it('grants 1 philosophy token to the player', () => {
      const player = makeTestPlayer({ philosophyTokens: 0 });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].philosophyTokens).toBe(1);
      }
    });

    it('adds to existing philosophy tokens', () => {
      const player = makeTestPlayer({ philosophyTokens: 3 });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].philosophyTokens).toBe(4);
      }
    });

    it('does not modify other players', () => {
      const p1 = makeTestPlayer({ playerId: 'player-1', philosophyTokens: 0 });
      const p2 = makeTestPlayer({ playerId: 'player-2', philosophyTokens: 4 });
      const state = makeTestGameState({ players: [p1, p2] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].philosophyTokens).toBe(1);
        expect(result.value.players[1].philosophyTokens).toBe(4);
      }
    });

    it('does not modify other resources', () => {
      const player = makeTestPlayer({ coins: 5, citizenTrack: 3, troopTrack: 1 });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        const p = result.value.players[0];
        expect(p.coins).toBe(5);
        expect(p.citizenTrack).toBe(3);
        expect(p.troopTrack).toBe(1);
      }
    });

    it('returns PLAYER_NOT_FOUND for unknown player', () => {
      const state = makeTestGameState();

      const result = resolver.resolve(state, 'unknown', {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLAYER_NOT_FOUND');
      }
    });

    it('does not mutate the original state', () => {
      const player = makeTestPlayer({ philosophyTokens: 0 });
      const state = makeTestGameState({ players: [player] });

      resolver.resolve(state, 'player-1', {});

      expect(state.players[0].philosophyTokens).toBe(0);
    });
  });
});
