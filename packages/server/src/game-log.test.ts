import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { appendLogEntry, getLog } from './game-log';
import { makeTestGameState } from './test-helpers';
import type { GameState } from '@khora/shared';

function makeTestState(): GameState {
  return makeTestGameState({
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  });
}

describe('game-log', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000010000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('appendLogEntry', () => {
    it('adds a timestamped entry to the log', () => {
      const state = makeTestState();
      const updated = appendLogEntry(state, {
        roundNumber: 1,
        phase: 'OMEN',
        playerId: null,
        action: 'Event card revealed',
        details: { cardId: 'e1' },
      });
      expect(updated.gameLog).toHaveLength(1);
      expect(updated.gameLog[0].timestamp).toBe(1700000010000);
      expect(updated.gameLog[0].action).toBe('Event card revealed');
    });

    it('does not mutate the original state', () => {
      const state = makeTestState();
      appendLogEntry(state, {
        roundNumber: 1,
        phase: 'OMEN',
        playerId: null,
        action: 'test',
        details: {},
      });
      expect(state.gameLog).toHaveLength(0);
    });

    it('appends multiple entries', () => {
      let state = makeTestState();
      state = appendLogEntry(state, {
        roundNumber: 1,
        phase: 'OMEN',
        playerId: null,
        action: 'first',
        details: {},
      });
      vi.setSystemTime(1700000020000);
      state = appendLogEntry(state, {
        roundNumber: 1,
        phase: 'TAXATION',
        playerId: 'p1',
        action: 'second',
        details: {},
      });
      expect(state.gameLog).toHaveLength(2);
      expect(state.gameLog[0].action).toBe('first');
      expect(state.gameLog[1].action).toBe('second');
    });
  });

  describe('getLog', () => {
    it('returns entries in chronological order', () => {
      const state = makeTestState();
      // Manually insert out-of-order entries
      state.gameLog = [
        { timestamp: 300, roundNumber: 1, phase: 'DICE', playerId: null, action: 'third', details: {} },
        { timestamp: 100, roundNumber: 1, phase: 'OMEN', playerId: null, action: 'first', details: {} },
        { timestamp: 200, roundNumber: 1, phase: 'TAXATION', playerId: null, action: 'second', details: {} },
      ];
      const log = getLog(state);
      expect(log[0].action).toBe('first');
      expect(log[1].action).toBe('second');
      expect(log[2].action).toBe('third');
    });

    it('returns empty array for empty log', () => {
      const state = makeTestState();
      expect(getLog(state)).toEqual([]);
    });

    it('does not mutate the original log', () => {
      const state = makeTestState();
      state.gameLog = [
        { timestamp: 200, roundNumber: 1, phase: 'OMEN', playerId: null, action: 'b', details: {} },
        { timestamp: 100, roundNumber: 1, phase: 'OMEN', playerId: null, action: 'a', details: {} },
      ];
      const log = getLog(state);
      expect(log[0].action).toBe('a');
      // Original should be unchanged
      expect(state.gameLog[0].action).toBe('b');
    });
  });
});
