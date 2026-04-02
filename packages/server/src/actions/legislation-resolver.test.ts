import { describe, it, expect } from 'vitest';
import { LegislationResolver } from './legislation-resolver';
import { makeTestPlayer, makeTestGameState, makeTestPoliticsCard } from '../test-helpers';

describe('LegislationResolver', () => {
  const resolver = new LegislationResolver();

  describe('metadata', () => {
    it('has actionNumber 1', () => {
      expect(resolver.actionNumber).toBe(1);
    });

    it('has actionType LEGISLATION', () => {
      expect(resolver.actionType).toBe('LEGISLATION');
    });
  });

  describe('canPerform', () => {
    it('returns citizenCost 0 for die values >= 1', () => {
      const card1 = makeTestPoliticsCard('pc-1');
      const state = makeTestGameState({ politicsDeck: [card1] });
      for (let die = 1; die <= 6; die++) {
        const result = resolver.canPerform(state, 'player-1', die);
        expect(result.canPerform).toBe(true);
        expect(result.citizenCost).toBe(0);
      }
    });

    it('returns canPerform false when politics deck is empty', () => {
      const state = makeTestGameState({ politicsDeck: [] });
      const result = resolver.canPerform(state, 'player-1', 3);
      expect(result.canPerform).toBe(false);
    });

    it('returns canPerform false for unknown player', () => {
      const state = makeTestGameState();
      const result = resolver.canPerform(state, 'unknown', 3);
      expect(result.canPerform).toBe(false);
    });
  });

  describe('resolve', () => {
    it('gains 3 citizens', () => {
      const player = makeTestPlayer({ citizenTrack: 2 });
      const card1 = makeTestPoliticsCard('pc-1');
      const card2 = makeTestPoliticsCard('pc-2');
      const state = makeTestGameState({ players: [player], politicsDeck: [card1, card2] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].citizenTrack).toBe(5); // 2 + 3
      }
    });

    it('draws cards and keeps the chosen one in hand', () => {
      const player = makeTestPlayer({ handCards: [] });
      const card1 = makeTestPoliticsCard('pc-1');
      const card2 = makeTestPoliticsCard('pc-2');
      const state = makeTestGameState({ players: [player], politicsDeck: [card1, card2] });

      const result = resolver.resolve(state, 'player-1', { targetCardId: 'pc-1' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].handCards).toHaveLength(1);
        expect(result.value.players[0].handCards[0].id).toBe('pc-1');
      }
    });

    it('keeps the first drawn card when no targetCardId provided', () => {
      const player = makeTestPlayer({ handCards: [] });
      const card1 = makeTestPoliticsCard('pc-1');
      const card2 = makeTestPoliticsCard('pc-2');
      const state = makeTestGameState({ players: [player], politicsDeck: [card1, card2] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].handCards).toHaveLength(1);
        expect(result.value.players[0].handCards[0].id).toBe('pc-1');
      }
    });

    it('removes drawn cards from the politics deck', () => {
      const card1 = makeTestPoliticsCard('pc-1');
      const card2 = makeTestPoliticsCard('pc-2');
      const card3 = makeTestPoliticsCard('pc-3');
      const state = makeTestGameState({ politicsDeck: [card1, card2, card3] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Drew 2 cards from deck of 3, kept 1, unchosen goes back to bottom → 2 remain
        expect(result.value.politicsDeck).toHaveLength(2);
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
      const p1 = makeTestPlayer({ playerId: 'player-1', citizenTrack: 2, handCards: [] });
      const p2 = makeTestPlayer({ playerId: 'player-2', citizenTrack: 3, handCards: [] });
      const card1 = makeTestPoliticsCard('pc-1');
      const card2 = makeTestPoliticsCard('pc-2');
      const state = makeTestGameState({ players: [p1, p2], politicsDeck: [card1, card2] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[1].citizenTrack).toBe(3);
        expect(result.value.players[1].handCards).toHaveLength(0);
      }
    });

    it('does not mutate the original state', () => {
      const player = makeTestPlayer({ citizenTrack: 2, handCards: [] });
      const card1 = makeTestPoliticsCard('pc-1');
      const card2 = makeTestPoliticsCard('pc-2');
      const state = makeTestGameState({ players: [player], politicsDeck: [card1, card2] });

      resolver.resolve(state, 'player-1', {});

      expect(state.players[0].citizenTrack).toBe(2);
      expect(state.players[0].handCards).toHaveLength(0);
    });

    it('handles deck with only 1 card gracefully', () => {
      const player = makeTestPlayer({ handCards: [] });
      const card1 = makeTestPoliticsCard('pc-1');
      const state = makeTestGameState({ players: [player], politicsDeck: [card1] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].handCards).toHaveLength(1);
        expect(result.value.politicsDeck).toHaveLength(0);
      }
    });
  });
});
