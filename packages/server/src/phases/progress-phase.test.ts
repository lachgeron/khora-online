import { describe, it, expect } from 'vitest';
import { ProgressPhaseManager } from './progress-phase';
import { makeTestPlayer, makeTestGameState, makeTestEventCard } from '../test-helpers';

describe('ProgressPhaseManager', () => {
  const manager = new ProgressPhaseManager();

  describe('onEnter', () => {
    it('adds PROGRESS_TRACK pending decision for each connected player in turn order', () => {
      const p1 = makeTestPlayer({ playerId: 'p1', isConnected: true });
      const p2 = makeTestPlayer({ playerId: 'p2', isConnected: true });
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        players: [p1, p2],
        turnOrder: ['p1', 'p2'],
        pendingDecisions: [],
      });

      const result = manager.onEnter(state);

      expect(result.pendingDecisions).toHaveLength(2);
      expect(result.pendingDecisions[0].playerId).toBe('p1');
      expect(result.pendingDecisions[0].decisionType).toBe('PROGRESS_TRACK');
      expect(result.pendingDecisions[1].playerId).toBe('p2');
    });

    it('does not add pending decision for disconnected players', () => {
      const p1 = makeTestPlayer({ playerId: 'p1', isConnected: true });
      const p2 = makeTestPlayer({ playerId: 'p2', isConnected: false });
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        players: [p1, p2],
        turnOrder: ['p1', 'p2'],
        pendingDecisions: [],
      });

      const result = manager.onEnter(state);

      expect(result.pendingDecisions).toHaveLength(1);
      expect(result.pendingDecisions[0].playerId).toBe('p1');
    });

    it('does not mutate the original state', () => {
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        pendingDecisions: [],
      });
      manager.onEnter(state);
      expect(state.pendingDecisions).toHaveLength(0);
    });
  });

  describe('handleDecision -- PROGRESS_TRACK', () => {
    it('advances a single track and deducts coins (Req 15.1, 15.2)', () => {
      const player = makeTestPlayer({ playerId: 'p1', coins: 10, economyTrack: 3 });
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        players: [player],
        pendingDecisions: [
          { playerId: 'p1', decisionType: 'PROGRESS_TRACK' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.handleDecision(state, 'p1', {
        type: 'PROGRESS_TRACK',
        advancement: { track: 'ECONOMY' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].economyTrack).toBe(4);
        // coins deducted by the progress cost for level 3
        expect(result.value.players[0].coins).toBeLessThan(10);
      }
    });

    it('rejects when insufficient coins', () => {
      const player = makeTestPlayer({ playerId: 'p1', coins: 0, economyTrack: 3 });
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        players: [player],
        pendingDecisions: [
          { playerId: 'p1', decisionType: 'PROGRESS_TRACK' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.handleDecision(state, 'p1', {
        type: 'PROGRESS_TRACK',
        advancement: { track: 'ECONOMY' },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSUFFICIENT_RESOURCES');
      }
    });

    it('removes pending decision after successful advancement', () => {
      const player = makeTestPlayer({ playerId: 'p1', coins: 10, economyTrack: 1 });
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        players: [player],
        pendingDecisions: [
          { playerId: 'p1', decisionType: 'PROGRESS_TRACK' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.handleDecision(state, 'p1', {
        type: 'PROGRESS_TRACK',
        advancement: { track: 'ECONOMY' },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.pendingDecisions).toHaveLength(0);
      }
    });

    it('rejects unknown player', () => {
      const player = makeTestPlayer({ playerId: 'p1' });
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        players: [player],
        pendingDecisions: [
          { playerId: 'unknown', decisionType: 'PROGRESS_TRACK' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.handleDecision(state, 'unknown', {
        type: 'PROGRESS_TRACK',
        advancement: { track: 'ECONOMY' },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLAYER_NOT_FOUND');
      }
    });
  });

  describe('handleDecision -- SKIP_PHASE', () => {
    it('removes pending decision without changing tracks or coins', () => {
      const player = makeTestPlayer({ playerId: 'p1', coins: 10, economyTrack: 3 });
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        players: [player],
        pendingDecisions: [
          { playerId: 'p1', decisionType: 'PROGRESS_TRACK' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.handleDecision(state, 'p1', { type: 'SKIP_PHASE' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].economyTrack).toBe(3);
        expect(result.value.players[0].coins).toBe(10);
        expect(result.value.pendingDecisions).toHaveLength(0);
      }
    });
  });

  describe('handleDecision -- wrong message type', () => {
    it('rejects non-progress message types', () => {
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        pendingDecisions: [
          { playerId: 'player-1', decisionType: 'PROGRESS_TRACK' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.handleDecision(state, 'player-1', { type: 'HEARTBEAT' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_MESSAGE');
      }
    });
  });

  describe('isComplete', () => {
    it('returns true when no pending decisions remain', () => {
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        pendingDecisions: [],
      });
      expect(manager.isComplete(state)).toBe(true);
    });

    it('returns false when pending decisions remain', () => {
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        pendingDecisions: [
          { playerId: 'player-1', decisionType: 'PROGRESS_TRACK' as any, timeoutAt: 0, options: null as any },
        ],
      });
      expect(manager.isComplete(state)).toBe(false);
    });
  });

  describe('autoResolve', () => {
    it('removes pending decision for the player (skip progress)', () => {
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        players: [makeTestPlayer({ playerId: 'p1', coins: 10, economyTrack: 3 })],
        pendingDecisions: [
          { playerId: 'p1', decisionType: 'PROGRESS_TRACK' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.autoResolve(state, 'p1');

      expect(result.pendingDecisions).toHaveLength(0);
      expect(result.players[0].economyTrack).toBe(3);
      expect(result.players[0].coins).toBe(10);
    });

    it('does not affect other players pending decisions', () => {
      const p1 = makeTestPlayer({ playerId: 'p1' });
      const p2 = makeTestPlayer({ playerId: 'p2' });
      const state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        players: [p1, p2],
        pendingDecisions: [
          { playerId: 'p1', decisionType: 'PROGRESS_TRACK' as any, timeoutAt: 0, options: null as any },
          { playerId: 'p2', decisionType: 'PROGRESS_TRACK' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.autoResolve(state, 'p1');

      expect(result.pendingDecisions).toHaveLength(1);
      expect(result.pendingDecisions[0].playerId).toBe('p2');
    });
  });

  describe('multi-player flow (Req 15.5)', () => {
    it('completes when all players have decided', () => {
      const p1 = makeTestPlayer({ playerId: 'p1', coins: 10, economyTrack: 1 });
      const p2 = makeTestPlayer({ playerId: 'p2', coins: 10, cultureTrack: 1 });
      let state = makeTestGameState({
        currentPhase: 'PROGRESS' as any,
        players: [p1, p2],
        turnOrder: ['p1', 'p2'],
      });

      // onEnter sets up pending decisions
      state = manager.onEnter(state);
      expect(manager.isComplete(state)).toBe(false);

      // Player 1 advances
      const r1 = manager.handleDecision(state, 'p1', {
        type: 'PROGRESS_TRACK',
        advancement: { track: 'ECONOMY' },
      });
      expect(r1.ok).toBe(true);
      if (r1.ok) state = r1.value;
      expect(manager.isComplete(state)).toBe(false);

      // Player 2 skips
      const r2 = manager.handleDecision(state, 'p2', { type: 'SKIP_PHASE' });
      expect(r2.ok).toBe(true);
      if (r2.ok) state = r2.value;
      expect(manager.isComplete(state)).toBe(true);
    });
  });
});
