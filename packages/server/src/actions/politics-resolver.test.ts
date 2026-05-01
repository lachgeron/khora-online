import { describe, it, expect } from 'vitest';
import { PoliticsResolver } from './politics-resolver';
import { makeTestPlayer, makeTestGameState, makeTestPoliticsCard } from '../test-helpers';

describe('PoliticsResolver', () => {
  const resolver = new PoliticsResolver();

  describe('metadata', () => {
    it('has actionNumber 5', () => {
      expect(resolver.actionNumber).toBe(5);
    });

    it('has actionType POLITICS', () => {
      expect(resolver.actionType).toBe('POLITICS');
    });
  });

  describe('canPerform', () => {
    it('returns citizenCost 0 for die value >= 5', () => {
      const card = makeTestPoliticsCard('card-1', { cost: 2 });
      const player = makeTestPlayer({ coins: 10, handCards: [card] });
      const state = makeTestGameState({ players: [player] });
      for (let die = 5; die <= 6; die++) {
        const result = resolver.canPerform(state, 'player-1', die);
        expect(result.canPerform).toBe(true);
        expect(result.citizenCost).toBe(0);
      }
    });

    it('returns citizenCost 1 for die value 4', () => {
      const card = makeTestPoliticsCard('card-1', { cost: 2 });
      const player = makeTestPlayer({ coins: 10, handCards: [card] });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.canPerform(state, 'player-1', 4);
      expect(result.citizenCost).toBe(1);
    });

    it('returns citizenCost 4 for die value 1', () => {
      const card = makeTestPoliticsCard('card-1', { cost: 2 });
      const player = makeTestPlayer({ coins: 10, handCards: [card] });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.canPerform(state, 'player-1', 1);
      expect(result.citizenCost).toBe(4);
    });

    it('returns canPerform false when hand is empty', () => {
      const player = makeTestPlayer({ handCards: [] });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.canPerform(state, 'player-1', 6);
      expect(result.canPerform).toBe(false);
    });

    it('returns canPerform false when no affordable card in hand', () => {
      const card = makeTestPoliticsCard('card-1', { cost: 100 });
      const player = makeTestPlayer({ coins: 1, handCards: [card] });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.canPerform(state, 'player-1', 6);
      expect(result.canPerform).toBe(false);
    });
  });

  describe('resolve', () => {
    it('plays a card from hand and deducts cost', () => {
      const card = makeTestPoliticsCard('card-1', { cost: 3, type: 'ONGOING' });
      const player = makeTestPlayer({ coins: 10, handCards: [card], playedCards: [] });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', { targetCardId: 'card-1' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].coins).toBe(7); // 10 - 3
        expect(result.value.players[0].handCards).toHaveLength(0);
        expect(result.value.players[0].playedCards).toHaveLength(1);
        expect(result.value.players[0].playedCards[0].id).toBe('card-1');
      }
    });

    it('applies immediate effects for IMMEDIATE cards', () => {
      const card = makeTestPoliticsCard('card-1', {
        cost: 2,
        type: 'IMMEDIATE',
        effect: { type: 'GAIN_VP', amount: 3 },
      });
      const player = makeTestPlayer({ coins: 5, victoryPoints: 0, handCards: [card], playedCards: [] });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', { targetCardId: 'card-1' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].victoryPoints).toBe(3);
        expect(result.value.players[0].coins).toBe(3); // 5 - 2
      }
    });

    it('preserves Council deck changes after drawing cards', () => {
      const council = makeTestPoliticsCard('council', {
        cost: 0,
        type: 'IMMEDIATE',
        effect: { type: 'GAIN_VP', amount: 0 },
      });
      const drawn1 = makeTestPoliticsCard('drawn-1');
      const drawn2 = makeTestPoliticsCard('drawn-2');
      const remaining = makeTestPoliticsCard('remaining');
      const player = makeTestPlayer({
        coins: 5,
        handCards: [council],
        playedCards: [],
      });
      const state = makeTestGameState({
        players: [player],
        politicsDeck: [drawn1, drawn2, remaining],
      });

      const result = resolver.resolve(state, 'player-1', { targetCardId: 'council' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].handCards.map(c => c.id)).toEqual(['drawn-1', 'drawn-2']);
        expect(result.value.players[0].playedCards.map(c => c.id)).toEqual(['council']);
        expect(result.value.politicsDeck.map(c => c.id)).toEqual(['remaining']);
      }
    });

    it('does not apply effects for ONGOING cards', () => {
      const card = makeTestPoliticsCard('card-1', {
        cost: 2,
        type: 'ONGOING',
        effect: { type: 'GAIN_VP', amount: 5 },
      });
      const player = makeTestPlayer({ coins: 5, victoryPoints: 0, handCards: [card], playedCards: [] });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', { targetCardId: 'card-1' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].victoryPoints).toBe(0);
      }
    });

    it('returns INSUFFICIENT_RESOURCES when player cannot afford', () => {
      const card = makeTestPoliticsCard('card-1', { cost: 10 });
      const player = makeTestPlayer({ coins: 3, handCards: [card] });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', { targetCardId: 'card-1' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSUFFICIENT_RESOURCES');
      }
    });

    it('returns INVALID_DECISION when no targetCardId provided', () => {
      const card = makeTestPoliticsCard('card-1', { cost: 2 });
      const player = makeTestPlayer({ coins: 10, handCards: [card] });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_DECISION');
      }
    });

    it('returns CARD_NOT_IN_HAND when card not found in hand', () => {
      const card = makeTestPoliticsCard('card-1', { cost: 2 });
      const player = makeTestPlayer({ coins: 10, handCards: [card] });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', { targetCardId: 'nonexistent' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CARD_NOT_IN_HAND');
      }
    });

    it('returns PLAYER_NOT_FOUND for unknown player', () => {
      const state = makeTestGameState();
      const result = resolver.resolve(state, 'unknown', { targetCardId: 'card-1' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLAYER_NOT_FOUND');
      }
    });

    it('does not modify other players', () => {
      const card = makeTestPoliticsCard('card-1', { cost: 2 });
      const p1 = makeTestPlayer({ playerId: 'player-1', coins: 10, handCards: [card], playedCards: [] });
      const p2 = makeTestPlayer({ playerId: 'player-2', coins: 20, handCards: [], playedCards: [] });
      const state = makeTestGameState({ players: [p1, p2] });

      const result = resolver.resolve(state, 'player-1', { targetCardId: 'card-1' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[1].coins).toBe(20);
        expect(result.value.players[1].playedCards).toHaveLength(0);
      }
    });

    it('does not mutate the original state', () => {
      const card = makeTestPoliticsCard('card-1', { cost: 2 });
      const player = makeTestPlayer({ coins: 10, handCards: [card], playedCards: [] });
      const state = makeTestGameState({ players: [player] });

      resolver.resolve(state, 'player-1', { targetCardId: 'card-1' });

      expect(state.players[0].coins).toBe(10);
      expect(state.players[0].handCards).toHaveLength(1);
    });

    it('rejects when knowledge requirements not met', () => {
      const card = makeTestPoliticsCard('card-1', {
        cost: 2,
        knowledgeRequirement: { green: 2, blue: 0, red: 0 },
      });
      const player = makeTestPlayer({ coins: 10, handCards: [card], knowledgeTokens: [] });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', { targetCardId: 'card-1' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSUFFICIENT_KNOWLEDGE');
      }
    });
  });
});
