import { describe, it, expect } from 'vitest';
import { OmenPhaseManager } from './omen-phase';
import { makeTestPlayer, makeTestGameState, makeTestEventCard } from '../test-helpers';
import type { GameEffect } from '@khora/shared';

describe('OmenPhaseManager', () => {
  const manager = new OmenPhaseManager();

  describe('onEnter', () => {
    it('draws the top event card and sets it as currentEvent (Req 4.1)', () => {
      const card1 = makeTestEventCard('e1', { name: 'Event 1' });
      const card2 = makeTestEventCard('e2', { name: 'Event 2' });
      const state = makeTestGameState({ eventDeck: [card1, card2] });

      const result = manager.onEnter(state);

      expect(result.currentEvent).toEqual(card1);
    });

    it('decreases the event deck size by 1 (Req 4.1)', () => {
      const card1 = makeTestEventCard('e1');
      const card2 = makeTestEventCard('e2');
      const card3 = makeTestEventCard('e3');
      const state = makeTestGameState({ eventDeck: [card1, card2, card3] });

      const result = manager.onEnter(state);

      expect(result.eventDeck).toHaveLength(2);
      expect(result.eventDeck[0].id).toBe('e2');
      expect(result.eventDeck[1].id).toBe('e3');
    });

    it('does not apply immediate effects during omen (effects applied during glory)', () => {
      const effect: GameEffect = { type: 'GAIN_COINS', amount: 3 };
      const card = makeTestEventCard('e1', { immediateEffect: effect });
      const p1 = makeTestPlayer({ playerId: 'p1', coins: 5 });
      const p2 = makeTestPlayer({ playerId: 'p2', coins: 10 });
      const state = makeTestGameState({
        eventDeck: [card],
        players: [p1, p2],
      });

      const result = manager.onEnter(state);

      // Omen only reveals the card — effects are applied during Glory phase
      expect(result.players[0].coins).toBe(5);
      expect(result.players[1].coins).toBe(10);
      expect(result.currentEvent).toEqual(card);
    });

    it('handles event card with no immediate effect', () => {
      const card = makeTestEventCard('e1', { immediateEffect: null });
      const player = makeTestPlayer({ coins: 5 });
      const state = makeTestGameState({ eventDeck: [card], players: [player] });

      const result = manager.onEnter(state);

      expect(result.currentEvent).toEqual(card);
      expect(result.players[0].coins).toBe(5);
    });

    it('handles empty event deck gracefully', () => {
      const state = makeTestGameState({ eventDeck: [] });

      const result = manager.onEnter(state);

      expect(result.currentEvent).toBeNull();
      expect(result.eventDeck).toHaveLength(0);
    });

    it('does not apply LOSE_COINS during omen', () => {
      const effect: GameEffect = { type: 'LOSE_COINS', amount: 2 };
      const card = makeTestEventCard('e1', { immediateEffect: effect });
      const player = makeTestPlayer({ coins: 5 });
      const state = makeTestGameState({ eventDeck: [card], players: [player] });

      const result = manager.onEnter(state);

      expect(result.players[0].coins).toBe(5);
    });

    it('does not apply COMPOSITE during omen', () => {
      const effect: GameEffect = {
        type: 'COMPOSITE',
        effects: [
          { type: 'GAIN_COINS', amount: 2 },
          { type: 'GAIN_VP', amount: 1 },
        ],
      };
      const card = makeTestEventCard('e1', { immediateEffect: effect });
      const player = makeTestPlayer({ coins: 5, victoryPoints: 10 });
      const state = makeTestGameState({ eventDeck: [card], players: [player] });

      const result = manager.onEnter(state);

      expect(result.players[0].coins).toBe(5);
      expect(result.players[0].victoryPoints).toBe(10);
    });

    it('does not mutate the original state', () => {
      const card = makeTestEventCard('e1');
      const state = makeTestGameState({ eventDeck: [card] });
      const originalDeckLength = state.eventDeck.length;

      manager.onEnter(state);

      expect(state.eventDeck.length).toBe(originalDeckLength);
      expect(state.currentEvent).toBeNull();
    });

    it('draws from a pre-shuffled deck in order (Req 4.4)', () => {
      const cards = [
        makeTestEventCard('e1'),
        makeTestEventCard('e2'),
        makeTestEventCard('e3'),
      ];
      let state = makeTestGameState({ eventDeck: cards });

      // Round 1
      state = manager.onEnter(state);
      expect(state.currentEvent!.id).toBe('e1');
      expect(state.eventDeck).toHaveLength(2);

      // Round 2
      state = manager.onEnter(state);
      expect(state.currentEvent!.id).toBe('e2');
      expect(state.eventDeck).toHaveLength(1);

      // Round 3
      state = manager.onEnter(state);
      expect(state.currentEvent!.id).toBe('e3');
      expect(state.eventDeck).toHaveLength(0);
    });
  });

  describe('handleDecision', () => {
    it('returns WRONG_PHASE error for any decision', () => {
      const state = makeTestGameState();
      const result = manager.handleDecision(state, 'player-1', { type: 'SKIP_PHASE' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('WRONG_PHASE');
      }
    });
  });

  describe('isComplete', () => {
    it('returns false when display pending decision exists', () => {
      const state = makeTestGameState({
        pendingDecisions: [{ playerId: '__display__', decisionType: 'PHASE_DISPLAY' as any, timeoutAt: Date.now() + 5000, options: null }],
      });
      expect(manager.isComplete(state)).toBe(false);
    });

    it('returns true when no pending decisions', () => {
      const state = makeTestGameState({ pendingDecisions: [] });
      expect(manager.isComplete(state)).toBe(true);
    });
  });

  describe('autoResolve', () => {
    it('clears pending decisions', () => {
      const state = makeTestGameState({
        pendingDecisions: [{ playerId: '__display__', decisionType: 'PHASE_DISPLAY' as any, timeoutAt: Date.now() + 5000, options: null }],
      });
      const result = manager.autoResolve(state, '__display__');
      expect(result.pendingDecisions).toEqual([]);
    });
  });
});
