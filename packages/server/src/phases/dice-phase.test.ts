import { describe, it, expect } from 'vitest';
import { DicePhaseManager } from './dice-phase';
import { ACTION_NUMBERS } from '@khora/shared';
import { makeTestPlayer, makeTestGameState } from '../test-helpers';
import type { ActionSlot } from '@khora/shared';

function makeSlot(overrides: Partial<ActionSlot> = {}): ActionSlot {
  return {
    actionType: 'TRADE',
    assignedDie: 4,
    resolved: false,
    citizenCost: 0,
    ...overrides,
  };
}

describe('DicePhaseManager', () => {
  const manager = new DicePhaseManager();

  describe('onEnter', () => {
    it('creates ROLL_DICE pending decisions and clears dice rolls', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [
          makeTestPlayer({ playerId: 'p1', diceRoll: [3, 5] }),
          makeTestPlayer({ playerId: 'p2', diceRoll: [2, 4] }),
        ],
      });

      const result = manager.onEnter(state);

      // Dice rolls should be cleared
      for (const player of result.players) {
        expect(player.diceRoll).toBeNull();
      }

      // Should have ROLL_DICE pending decisions
      expect(result.pendingDecisions).toHaveLength(2);
      expect(result.pendingDecisions[0].decisionType).toBe('ROLL_DICE');
      expect(result.pendingDecisions[1].decisionType).toBe('ROLL_DICE');
    });

    it('clears action slots on enter', () => {
      const slot = makeSlot();
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ actionSlots: [slot, slot, null] })],
      });

      const result = manager.onEnter(state);

      expect(result.players[0].actionSlots).toEqual([null, null, null]);
    });

    it('does not mutate the original state', () => {
      const state = makeTestGameState({ currentPhase: 'DICE' as any });
      const originalDiceRoll = state.players[0].diceRoll;

      manager.onEnter(state);

      expect(state.players[0].diceRoll).toBe(originalDiceRoll);
    });
  });

  describe('handleDecision - ROLL_DICE', () => {
    it('rolls dice for a player with values 1-6', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [
          makeTestPlayer({ playerId: 'p1', diceRoll: null }),
          makeTestPlayer({ playerId: 'p2', diceRoll: null }),
        ],
        pendingDecisions: [
          { playerId: 'p1', decisionType: 'ROLL_DICE' as any, timeoutAt: 0, options: null as any },
          { playerId: 'p2', decisionType: 'ROLL_DICE' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.handleDecision(state, 'p1', { type: 'ROLL_DICE' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const p1 = result.value.players[0];
        expect(p1.diceRoll).not.toBeNull();
        expect(p1.diceRoll!.length).toBeGreaterThanOrEqual(2);
        for (const die of p1.diceRoll!) {
          expect(die).toBeGreaterThanOrEqual(1);
          expect(die).toBeLessThanOrEqual(6);
        }
        // p2 still hasn't rolled
        expect(result.value.players[1].diceRoll).toBeNull();
      }
    });

    it('rejects if player already rolled', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ playerId: 'p1', diceRoll: [3, 5] })],
      });

      const result = manager.handleDecision(state, 'p1', { type: 'ROLL_DICE' });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('ALREADY_ROLLED');
    });

    it('creates ASSIGN_DICE decisions once all players have rolled', () => {
      // p2 already rolled, p1 is about to roll
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [
          makeTestPlayer({ playerId: 'p1', diceRoll: null }),
          makeTestPlayer({ playerId: 'p2', diceRoll: [4, 2] }),
        ],
        pendingDecisions: [
          { playerId: 'p1', decisionType: 'ROLL_DICE' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.handleDecision(state, 'p1', { type: 'ROLL_DICE' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // All have rolled -> ASSIGN_DICE decisions created
        expect(result.value.pendingDecisions).toHaveLength(2);
        expect(result.value.pendingDecisions[0].decisionType).toBe('ASSIGN_DICE');
        expect(result.value.pendingDecisions[1].decisionType).toBe('ASSIGN_DICE');
      }
    });
  });

  describe('handleDecision - ASSIGN_DICE', () => {
    it('rejects unknown player', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ playerId: 'p1', diceRoll: [3, 5] })],
      });

      const result = manager.handleDecision(state, 'unknown', {
        type: 'ASSIGN_DICE',
        assignments: [
          { slotIndex: 0, actionType: 'PHILOSOPHY', dieValue: 3 },
          { slotIndex: 1, actionType: 'TRADE', dieValue: 5 },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('PLAYER_NOT_FOUND');
    });

    it('rejects if player has not rolled yet', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ playerId: 'p1', diceRoll: null })],
      });

      const result = manager.handleDecision(state, 'p1', {
        type: 'ASSIGN_DICE',
        assignments: [
          { slotIndex: 0, actionType: 'PHILOSOPHY', dieValue: 3 },
          { slotIndex: 1, actionType: 'TRADE', dieValue: 5 },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('DICE_NOT_ROLLED');
    });

    it('rejects duplicate action types (Req 6.4)', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ playerId: 'p1', diceRoll: [3, 5] })],
      });

      const result = manager.handleDecision(state, 'p1', {
        type: 'ASSIGN_DICE',
        assignments: [
          { slotIndex: 0, actionType: 'TRADE', dieValue: 3 },
          { slotIndex: 1, actionType: 'TRADE', dieValue: 5 },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('DUPLICATE_ACTION');
    });

    it('rejects die values that do not match the roll', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ playerId: 'p1', diceRoll: [3, 5] })],
      });

      const result = manager.handleDecision(state, 'p1', {
        type: 'ASSIGN_DICE',
        assignments: [
          { slotIndex: 0, actionType: 'PHILOSOPHY', dieValue: 4 },
          { slotIndex: 1, actionType: 'TRADE', dieValue: 5 },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INVALID_DECISION');
    });

    it('accepts valid assignment with no citizen cost (die >= action number)', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ playerId: 'p1', diceRoll: [3, 5], citizenTrack: 10 })],
      });

      const result = manager.handleDecision(state, 'p1', {
        type: 'ASSIGN_DICE',
        assignments: [
          { slotIndex: 0, actionType: 'PHILOSOPHY', dieValue: 3 },
          { slotIndex: 1, actionType: 'LEGISLATION', dieValue: 5 },
        ],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const p = result.value.players[0];
        expect(p.citizenTrack).toBe(10);
        expect(p.actionSlots[0]!.actionType).toBe('PHILOSOPHY');
        expect(p.actionSlots[0]!.assignedDie).toBe(3);
        expect(p.actionSlots[0]!.citizenCost).toBe(0);
        expect(p.actionSlots[1]!.actionType).toBe('LEGISLATION');
        expect(p.actionSlots[1]!.assignedDie).toBe(5);
        expect(p.actionSlots[1]!.citizenCost).toBe(0);
      }
    });

    it('calculates citizen cost when die < action number (Req 6.5)', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ playerId: 'p1', diceRoll: [2, 4], citizenTrack: 10 })],
      });

      const result = manager.handleDecision(state, 'p1', {
        type: 'ASSIGN_DICE',
        assignments: [
          { slotIndex: 0, actionType: 'MILITARY', dieValue: 2 },
          { slotIndex: 1, actionType: 'POLITICS', dieValue: 4 },
        ],
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        const p = result.value.players[0];
        const militaryNumber = ACTION_NUMBERS['MILITARY'];
        const politicsNumber = ACTION_NUMBERS['POLITICS'];
        const expectedMilitaryCost = Math.max(0, militaryNumber - 2);
        const expectedPoliticsCost = Math.max(0, politicsNumber - 4);
        expect(p.actionSlots[0]!.citizenCost).toBe(expectedMilitaryCost);
        expect(p.actionSlots[1]!.citizenCost).toBe(expectedPoliticsCost);
        expect(p.citizenTrack).toBe(10 - expectedMilitaryCost - expectedPoliticsCost);
      }
    });

    it('rejects when player has insufficient citizens (Req 6.5)', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ playerId: 'p1', diceRoll: [1, 2], citizenTrack: 2 })],
      });

      const result = manager.handleDecision(state, 'p1', {
        type: 'ASSIGN_DICE',
        assignments: [
          { slotIndex: 0, actionType: 'DEVELOPMENT', dieValue: 1 },
          { slotIndex: 1, actionType: 'POLITICS', dieValue: 2 },
        ],
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('INSUFFICIENT_RESOURCES');
    });

    it('does not mutate the original state', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ playerId: 'p1', diceRoll: [3, 5], citizenTrack: 10 })],
      });

      manager.handleDecision(state, 'p1', {
        type: 'ASSIGN_DICE',
        assignments: [
          { slotIndex: 0, actionType: 'PHILOSOPHY', dieValue: 3 },
          { slotIndex: 1, actionType: 'TRADE', dieValue: 5 },
        ],
      });

      expect(state.players[0].actionSlots).toEqual([null, null, null]);
      expect(state.players[0].citizenTrack).toBe(10);
    });
  });

  describe('isComplete', () => {
    it('returns true when no pending decisions remain', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        pendingDecisions: [],
      });

      expect(manager.isComplete(state)).toBe(true);
    });

    it('returns false when pending decisions remain', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        pendingDecisions: [
          { playerId: 'player-1', decisionType: 'ASSIGN_DICE' as any, timeoutAt: 0, options: null as any },
        ],
      });

      expect(manager.isComplete(state)).toBe(false);
    });
  });

  describe('autoResolve', () => {
    it('rolls and assigns different actions on timeout (Req 6.7)', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ playerId: 'p1', diceRoll: [3, 5], citizenTrack: 10 })],
        pendingDecisions: [
          { playerId: 'p1', decisionType: 'ASSIGN_DICE' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.autoResolve(state, 'p1');
      const p = result.players[0];

      expect(p.actionSlots[0]).not.toBeNull();
      expect(p.actionSlots[1]).not.toBeNull();
      expect(p.actionSlots[0]!.actionType).not.toBe(p.actionSlots[1]!.actionType);
    });

    it('auto-rolls dice if player has not rolled yet', () => {
      const state = makeTestGameState({
        currentPhase: 'DICE' as any,
        players: [makeTestPlayer({ playerId: 'p1', diceRoll: null })],
        pendingDecisions: [
          { playerId: 'p1', decisionType: 'ROLL_DICE' as any, timeoutAt: 0, options: null as any },
        ],
      });

      const result = manager.autoResolve(state, 'p1');
      const p = result.players[0];

      // Should have rolled
      expect(p.diceRoll).not.toBeNull();
      expect(p.diceRoll!.length).toBeGreaterThanOrEqual(2);
    });

    it('does nothing for unknown player', () => {
      const state = makeTestGameState({ currentPhase: 'DICE' as any });
      const result = manager.autoResolve(state, 'unknown');
      expect(result).toEqual(state);
    });
  });
});
