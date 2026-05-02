import { describe, it, expect } from 'vitest';
import { GloryPhaseManager } from './glory-phase';
import { makeTestPlayer, makeTestGameState, makeTestEventCard, makeTestPoliticsCard } from '../test-helpers';

describe('GloryPhaseManager', () => {
  const manager = new GloryPhaseManager();

  describe('onEnter', () => {
    it('does not award VP just for having most troops', () => {
      const event = makeTestEventCard('event-1');
      const p1 = makeTestPlayer({ playerId: 'p1', troopTrack: 5, victoryPoints: 0 });
      const p2 = makeTestPlayer({ playerId: 'p2', troopTrack: 2, victoryPoints: 0 });
      const state = makeTestGameState({
        currentPhase: 'GLORY',
        currentEvent: event,
        players: [p1, p2],
      });

      const result = manager.onEnter(state);

      expect(result.players[0].victoryPoints).toBe(0);
      expect(result.players[1].victoryPoints).toBe(0);
    });

    it('applies event effects without glory VP bonus', () => {
      const event = makeTestEventCard('event-1');
      const p1 = makeTestPlayer({ playerId: 'p1', troopTrack: 5, victoryPoints: 0 });
      const p2 = makeTestPlayer({ playerId: 'p2', troopTrack: 5, victoryPoints: 0 });
      const p3 = makeTestPlayer({ playerId: 'p3', troopTrack: 2, victoryPoints: 0 });
      const state = makeTestGameState({
        currentPhase: 'GLORY',
        currentEvent: event,
        players: [p1, p2, p3],
      });

      const result = manager.onEnter(state);

      // No glory VP awarded
      expect(result.players[0].victoryPoints).toBe(0);
      expect(result.players[1].victoryPoints).toBe(0);
      expect(result.players[2].victoryPoints).toBe(0);
    });

    it('preserves existing victory points', () => {
      const event = makeTestEventCard('event-1');
      const player = makeTestPlayer({ victoryPoints: 10 });
      const state = makeTestGameState({
        currentPhase: 'GLORY',
        currentEvent: event,
        players: [player],
      });

      const result = manager.onEnter(state);

      expect(result.players[0].victoryPoints).toBe(10);
    });

    it('handles no current event gracefully', () => {
      const state = makeTestGameState({
        currentPhase: 'GLORY',
        currentEvent: null,
      });
      const result = manager.onEnter(state);
      expect(result).toEqual(state);
    });

    it('does not award VP from troop comparison', () => {
      const event = makeTestEventCard('event-1');
      const p1 = makeTestPlayer({ playerId: 'p1', troopTrack: 5, victoryPoints: 0 });
      const p2 = makeTestPlayer({ playerId: 'p2', troopTrack: 3, victoryPoints: 0 });
      const p3 = makeTestPlayer({ playerId: 'p3', troopTrack: 5, victoryPoints: 0 });
      const state = makeTestGameState({
        currentPhase: 'GLORY',
        currentEvent: event,
        players: [p1, p2, p3],
      });

      const result = manager.onEnter(state);

      expect(result.players[0].victoryPoints).toBe(0);
      expect(result.players[1].victoryPoints).toBe(0);
      expect(result.players[2].victoryPoints).toBe(0);
    });

    it('does not mutate the original state', () => {
      const event = makeTestEventCard('event-1');
      const player = makeTestPlayer({ victoryPoints: 0 });
      const state = makeTestGameState({
        currentPhase: 'GLORY',
        currentEvent: event,
        players: [player],
      });

      manager.onEnter(state);

      expect(state.players[0].victoryPoints).toBe(0);
    });
  });

  describe('handleDecision', () => {
    it('returns NOT_YOUR_TURN error for non-Prosperity decisions', () => {
      const state = makeTestGameState({ currentPhase: 'GLORY', pendingDecisions: [] });
      const result = manager.handleDecision(state, 'player-1', { type: 'SKIP_PHASE' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_YOUR_TURN');
      }
    });

    it('applies Gradualism discount to Rise of Persia progress', () => {
      const player = makeTestPlayer({
        playerId: 'player-1',
        coins: 2,
        militaryTrack: 4,
        playedCards: [makeTestPoliticsCard('gradualism')],
      });
      const state = makeTestGameState({
        currentPhase: 'GLORY',
        players: [player],
        pendingDecisions: [{
          playerId: 'player-1',
          decisionType: 'RISE_OF_PERSIA_PROGRESS',
          timeoutAt: Date.now() + 30_000,
          options: null,
        }],
      });

      const result = manager.handleDecision(state, 'player-1', { type: 'EVENT_PROGRESS_TRACK', track: 'MILITARY' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].coins).toBe(0);
        expect(result.value.players[0].militaryTrack).toBe(5);
      }
    });
  });

  describe('isComplete', () => {
    it('returns true when no pending decisions', () => {
      expect(manager.isComplete(makeTestGameState({ pendingDecisions: [] }))).toBe(true);
    });

    it('returns false when pending decisions exist', () => {
      expect(manager.isComplete(makeTestGameState({
        pendingDecisions: [{ playerId: '__display__', decisionType: 'PHASE_DISPLAY', timeoutAt: Date.now() + 5000, options: null }],
      }))).toBe(false);
    });
  });

  describe('autoResolve', () => {
    it('clears display pending decisions', () => {
      const state = makeTestGameState({
        pendingDecisions: [{ playerId: '__display__', decisionType: 'PHASE_DISPLAY', timeoutAt: Date.now() + 5000, options: null }],
      });
      const result = manager.autoResolve(state, '__display__');
      expect(result.pendingDecisions).toHaveLength(0);
    });
  });
});
