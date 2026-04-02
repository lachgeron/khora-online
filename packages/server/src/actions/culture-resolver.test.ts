import { describe, it, expect } from 'vitest';
import { CultureResolver } from './culture-resolver';
import { makeTestPlayer, makeTestGameState } from '../test-helpers';

describe('CultureResolver', () => {
  const resolver = new CultureResolver();

  describe('metadata', () => {
    it('has actionNumber 2', () => {
      expect(resolver.actionNumber).toBe(2);
    });

    it('has actionType CULTURE', () => {
      expect(resolver.actionType).toBe('CULTURE');
    });
  });

  describe('canPerform', () => {
    it('returns citizenCost 0 for die values >= 2', () => {
      const state = makeTestGameState();
      for (let die = 2; die <= 6; die++) {
        const result = resolver.canPerform(state, 'player-1', die);
        expect(result.canPerform).toBe(true);
        expect(result.citizenCost).toBe(0);
      }
    });

    it('returns citizenCost 1 for die value 1', () => {
      const state = makeTestGameState();
      const result = resolver.canPerform(state, 'player-1', 1);
      expect(result.citizenCost).toBe(1);
    });
  });

  describe('resolve', () => {
    it('grants VP equal to culture track level', () => {
      for (let level = 0; level <= 7; level++) {
        const player = makeTestPlayer({ cultureTrack: level, victoryPoints: 0 });
        const state = makeTestGameState({ players: [player] });
        const result = resolver.resolve(state, 'player-1', {});
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.players[0].victoryPoints).toBe(level);
        }
      }
    });

    it('adds to existing victory points', () => {
      const player = makeTestPlayer({ cultureTrack: 5, victoryPoints: 10 });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.resolve(state, 'player-1', {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].victoryPoints).toBe(15); // 10 + 5
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

    it('does not modify other players', () => {
      const p1 = makeTestPlayer({ playerId: 'player-1', cultureTrack: 5, victoryPoints: 0 });
      const p2 = makeTestPlayer({ playerId: 'player-2', victoryPoints: 7 });
      const state = makeTestGameState({ players: [p1, p2] });
      const result = resolver.resolve(state, 'player-1', {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[1].victoryPoints).toBe(7);
      }
    });

    it('does not mutate the original state', () => {
      const player = makeTestPlayer({ cultureTrack: 3, victoryPoints: 0 });
      const state = makeTestGameState({ players: [player] });
      resolver.resolve(state, 'player-1', {});
      expect(state.players[0].victoryPoints).toBe(0);
    });
  });
});
