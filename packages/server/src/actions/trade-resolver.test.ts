import { describe, it, expect } from 'vitest';
import { TradeResolver } from './trade-resolver';
import { makeTestPlayer, makeTestGameState } from '../test-helpers';

describe('TradeResolver', () => {
  const resolver = new TradeResolver();

  describe('metadata', () => {
    it('has actionNumber 3', () => {
      expect(resolver.actionNumber).toBe(3);
    });

    it('has actionType TRADE', () => {
      expect(resolver.actionType).toBe('TRADE');
    });
  });

  describe('canPerform', () => {
    it('returns citizenCost 0 for die values >= 3', () => {
      const state = makeTestGameState();
      for (let die = 3; die <= 6; die++) {
        const result = resolver.canPerform(state, 'player-1', die);
        expect(result.canPerform).toBe(true);
        expect(result.citizenCost).toBe(0);
      }
    });

    it('returns citizenCost 1 for die value 2', () => {
      const state = makeTestGameState();
      const result = resolver.canPerform(state, 'player-1', 2);
      expect(result.citizenCost).toBe(1);
    });

    it('returns citizenCost 2 for die value 1', () => {
      const state = makeTestGameState();
      const result = resolver.canPerform(state, 'player-1', 1);
      expect(result.citizenCost).toBe(2);
    });
  });

  describe('resolve', () => {
    it('grants coins equal to economy track + 1', () => {
      for (let level = 0; level <= 7; level++) {
        const player = makeTestPlayer({ economyTrack: level, coins: 0 });
        const state = makeTestGameState({ players: [player] });
        const result = resolver.resolve(state, 'player-1', {});
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.players[0].coins).toBe(level + 1);
        }
      }
    });

    it('adds to existing coins', () => {
      const player = makeTestPlayer({ economyTrack: 4, coins: 10 });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.resolve(state, 'player-1', {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].coins).toBe(15); // 10 + (4 + 1)
      }
    });

    it('optionally buys a Minor Knowledge token for 5 coins', () => {
      const player = makeTestPlayer({ economyTrack: 3, coins: 10, knowledgeTokens: [] });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.resolve(state, 'player-1', {
        buyMinorKnowledge: true,
        minorKnowledgeColor: 'GREEN',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Gained 4 coins (3+1), then spent 5 for knowledge token: 10 + 4 - 5 = 9
        expect(result.value.players[0].coins).toBe(9);
        expect(result.value.players[0].knowledgeTokens).toHaveLength(1);
        expect(result.value.players[0].knowledgeTokens[0].color).toBe('GREEN');
        expect(result.value.players[0].knowledgeTokens[0].tokenType).toBe('MINOR');
      }
    });

    it('returns INSUFFICIENT_RESOURCES when cannot afford knowledge token', () => {
      const player = makeTestPlayer({ economyTrack: 0, coins: 0, knowledgeTokens: [] });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.resolve(state, 'player-1', {
        buyMinorKnowledge: true,
        minorKnowledgeColor: 'BLUE',
      });
      // Gains 1 coin (0+1) then tries to spend 5: should fail
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSUFFICIENT_RESOURCES');
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
      const p1 = makeTestPlayer({ playerId: 'player-1', economyTrack: 5, coins: 0 });
      const p2 = makeTestPlayer({ playerId: 'player-2', coins: 10 });
      const state = makeTestGameState({ players: [p1, p2] });
      const result = resolver.resolve(state, 'player-1', {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[1].coins).toBe(10);
      }
    });

    it('does not mutate the original state', () => {
      const player = makeTestPlayer({ economyTrack: 3, coins: 5 });
      const state = makeTestGameState({ players: [player] });
      resolver.resolve(state, 'player-1', {});
      expect(state.players[0].coins).toBe(5);
    });
  });
});
