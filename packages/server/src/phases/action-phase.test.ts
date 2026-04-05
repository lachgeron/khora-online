import { describe, it, expect } from 'vitest';
import { ActionPhaseManager } from './action-phase';
import { makeTestPlayer, makeTestGameState } from '../test-helpers';
import type { ActionSlot } from '@khora/shared';

function makeSlot(overrides: Partial<ActionSlot> = {}): ActionSlot {
  return {
    actionType: 'PHILOSOPHY',
    assignedDie: 3,
    resolved: false,
    citizenCost: 0,
    ...overrides,
  };
}

describe('ActionPhaseManager', () => {
  const manager = new ActionPhaseManager();

  describe('onEnter', () => {
    it('creates pending decisions for connected players with unresolved actions', () => {
      const player = makeTestPlayer({
        actionSlots: [
          makeSlot({ actionType: 'PHILOSOPHY', assignedDie: 3 }),
          makeSlot({ actionType: 'CULTURE', assignedDie: 5 }),
          null,
        ],
      });
      const state = makeTestGameState({ currentPhase: 'ACTIONS' as any, players: [player] });

      const result = manager.onEnter(state);

      expect(result.pendingDecisions).toHaveLength(1);
      expect(result.pendingDecisions[0].playerId).toBe('player-1');
    });

    it('creates a display pause for players with all null slots', () => {
      const player = makeTestPlayer({ actionSlots: [null, null, null] });
      const state = makeTestGameState({ currentPhase: 'ACTIONS' as any, players: [player] });

      const result = manager.onEnter(state);

      expect(result.pendingDecisions).toHaveLength(1);
      expect(result.pendingDecisions[0].decisionType).toBe('PHASE_DISPLAY');
      expect(result.pendingDecisions[0].playerId).toBe('__display__');
    });
  });

  describe('handleDecision', () => {
    it('rejects non-RESOLVE_ACTION decisions', () => {
      const state = makeTestGameState({ currentPhase: 'ACTIONS' as any });
      const result = manager.handleDecision(state, 'player-1', { type: 'ROLL_DICE' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_MESSAGE');
      }
    });

    it('resolves a single action and marks slot as resolved', () => {
      const player = makeTestPlayer({
        knowledgeTokens: [],
        actionSlots: [
          makeSlot({ actionType: 'PHILOSOPHY', assignedDie: 3 }),
          makeSlot({ actionType: 'CULTURE', assignedDie: 5 }),
          null,
        ],
      });
      const state = makeTestGameState({
        currentPhase: 'ACTIONS' as any,
        players: [player],
        pendingDecisions: [
          { playerId: 'player-1', decisionType: 'RESOLVE_ACTION' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.handleDecision(state, 'player-1', {
        type: 'RESOLVE_ACTION',
        actionType: 'PHILOSOPHY',
        choices: {},
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].actionSlots[0]!.resolved).toBe(true);
        expect(result.value.players[0].actionSlots[1]!.resolved).toBe(false);
      }
    });
  });

  describe('isComplete', () => {
    it('returns true when all connected players have all slots resolved', () => {
      const player = makeTestPlayer({
        actionSlots: [
          makeSlot({ resolved: true }),
          makeSlot({ actionType: 'CULTURE', resolved: true }),
          null,
        ],
      });
      const state = makeTestGameState({
        currentPhase: 'ACTIONS' as any,
        players: [player],
        pendingDecisions: [],
      });

      expect(manager.isComplete(state)).toBe(true);
    });

    it('returns true when slots are null (no actions assigned)', () => {
      const player = makeTestPlayer({ actionSlots: [null, null, null] });
      const state = makeTestGameState({
        currentPhase: 'ACTIONS' as any,
        players: [player],
        pendingDecisions: [],
      });

      expect(manager.isComplete(state)).toBe(true);
    });

    it('returns false when any connected player has unresolved slots', () => {
      const player = makeTestPlayer({
        actionSlots: [
          makeSlot({ resolved: true }),
          makeSlot({ actionType: 'CULTURE', resolved: false }),
          null,
        ],
      });
      const state = makeTestGameState({
        currentPhase: 'ACTIONS' as any,
        players: [player],
        pendingDecisions: [],
      });

      expect(manager.isComplete(state)).toBe(false);
    });

    it('ignores disconnected players', () => {
      const p1 = makeTestPlayer({
        playerId: 'p1',
        isConnected: true,
        actionSlots: [
          makeSlot({ resolved: true }),
          makeSlot({ actionType: 'CULTURE', resolved: true }),
          null,
        ],
      });
      const p2 = makeTestPlayer({
        playerId: 'p2',
        isConnected: false,
        actionSlots: [
          makeSlot({ resolved: false }),
          null,
          null,
        ],
      });
      const state = makeTestGameState({
        currentPhase: 'ACTIONS' as any,
        players: [p1, p2],
        pendingDecisions: [],
      });

      expect(manager.isComplete(state)).toBe(true);
    });
  });

  describe('autoResolve', () => {
    it('resolves one unresolved action per call', () => {
      const player = makeTestPlayer({
        knowledgeTokens: [],
        actionSlots: [
          makeSlot({ actionType: 'PHILOSOPHY', assignedDie: 3, resolved: false }),
          makeSlot({ actionType: 'CULTURE', assignedDie: 5, resolved: false }),
          null,
        ],
      });
      const state = makeTestGameState({
        currentPhase: 'ACTIONS' as any,
        players: [player],
        pendingDecisions: [
          { playerId: 'player-1', decisionType: 'RESOLVE_ACTION' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.autoResolve(state, 'player-1');

      // Only the first (lowest cost) slot should be resolved
      expect(result.players[0].actionSlots[0]!.resolved).toBe(true);
      expect(result.players[0].actionSlots[1]!.resolved).toBe(false);
    });

    it('skips already-resolved slots', () => {
      const player = makeTestPlayer({
        knowledgeTokens: [],
        actionSlots: [
          makeSlot({ actionType: 'PHILOSOPHY', resolved: true }),
          makeSlot({ actionType: 'CULTURE', resolved: false }),
          null,
        ],
      });
      const state = makeTestGameState({
        currentPhase: 'ACTIONS' as any,
        players: [player],
        pendingDecisions: [
          { playerId: 'player-1', decisionType: 'RESOLVE_ACTION' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.autoResolve(state, 'player-1');

      // Culture slot now resolved
      expect(result.players[0].actionSlots[1]!.resolved).toBe(true);
    });

    it('inserts display pause for unknown player when no actions remain', () => {
      const state = makeTestGameState({ currentPhase: 'ACTIONS' as any });
      const result = manager.autoResolve(state, 'unknown');
      expect(result.pendingDecisions).toHaveLength(1);
      expect(result.pendingDecisions[0].decisionType).toBe('PHASE_DISPLAY');
    });

    it('handles null action slots gracefully', () => {
      const player = makeTestPlayer({ actionSlots: [null, null, null] });
      const state = makeTestGameState({
        currentPhase: 'ACTIONS' as any,
        players: [player],
        pendingDecisions: [
          { playerId: 'player-1', decisionType: 'RESOLVE_ACTION' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.autoResolve(state, 'player-1');
      expect(result.players[0].actionSlots).toEqual([null, null, null]);
      // No active player, so a display pause is inserted
      expect(result.pendingDecisions).toHaveLength(1);
      expect(result.pendingDecisions[0].decisionType).toBe('PHASE_DISPLAY');
    });
  });
});
