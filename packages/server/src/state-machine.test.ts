import { describe, it, expect } from 'vitest';
import { StateMachine } from './state-machine';
import type { GamePhase } from '@khora/shared';

describe('StateMachine', () => {
  it('starts in LOBBY phase at round 1 by default', () => {
    const sm = new StateMachine();
    expect(sm.currentPhase).toBe('LOBBY');
    expect(sm.roundNumber).toBe(1);
  });

  it('accepts custom initial phase and round', () => {
    const sm = new StateMachine('OMEN', 3);
    expect(sm.currentPhase).toBe('OMEN');
    expect(sm.roundNumber).toBe(3);
  });

  describe('canTransition', () => {
    it('allows LOBBY → CITY_SELECTION', () => {
      const sm = new StateMachine();
      expect(sm.canTransition('LOBBY', 'CITY_SELECTION')).toBe(true);
    });

    it('rejects LOBBY → OMEN', () => {
      const sm = new StateMachine();
      expect(sm.canTransition('LOBBY', 'OMEN')).toBe(false);
    });

    it('allows full round phase sequence', () => {
      const sm = new StateMachine('OMEN', 1);
      const roundPhases: [GamePhase, GamePhase][] = [
        ['OMEN', 'TAXATION'],
        ['TAXATION', 'DICE'],
        ['DICE', 'ACTIONS'],
        ['ACTIONS', 'PROGRESS'],
        ['PROGRESS', 'GLORY'],
        ['GLORY', 'ACHIEVEMENT'],
      ];
      for (const [from, to] of roundPhases) {
        expect(sm.canTransition(from, to)).toBe(true);
      }
    });

    it('allows ACHIEVEMENT → OMEN when round < 9', () => {
      const sm = new StateMachine('ACHIEVEMENT', 5);
      expect(sm.canTransition('ACHIEVEMENT', 'OMEN')).toBe(true);
    });

    it('rejects ACHIEVEMENT → FINAL_SCORING when round < 9', () => {
      const sm = new StateMachine('ACHIEVEMENT', 5);
      expect(sm.canTransition('ACHIEVEMENT', 'FINAL_SCORING')).toBe(false);
    });

    it('allows ACHIEVEMENT → FINAL_SCORING when round === 9', () => {
      const sm = new StateMachine('ACHIEVEMENT', 9);
      expect(sm.canTransition('ACHIEVEMENT', 'FINAL_SCORING')).toBe(true);
    });

    it('rejects ACHIEVEMENT → OMEN when round === 9', () => {
      const sm = new StateMachine('ACHIEVEMENT', 9);
      expect(sm.canTransition('ACHIEVEMENT', 'OMEN')).toBe(false);
    });

    it('allows FINAL_SCORING → GAME_OVER', () => {
      const sm = new StateMachine('FINAL_SCORING', 9);
      expect(sm.canTransition('FINAL_SCORING', 'GAME_OVER')).toBe(true);
    });

    it('rejects any transition from GAME_OVER', () => {
      const sm = new StateMachine('GAME_OVER', 9);
      const phases: GamePhase[] = [
        'LOBBY', 'CITY_SELECTION', 'OMEN', 'TAXATION', 'DICE',
        'ACTIONS', 'PROGRESS', 'GLORY', 'ACHIEVEMENT',
        'FINAL_SCORING', 'GAME_OVER',
      ];
      for (const p of phases) {
        expect(sm.canTransition('GAME_OVER', p)).toBe(false);
      }
    });
  });

  describe('transition', () => {
    it('transitions through the full pre-game sequence', () => {
      const sm = new StateMachine();
      sm.transition('CITY_SELECTION');
      expect(sm.currentPhase).toBe('CITY_SELECTION');
      sm.transition('DRAFT_POLITICS');
      expect(sm.currentPhase).toBe('DRAFT_POLITICS');
      sm.transition('OMEN');
      expect(sm.currentPhase).toBe('OMEN');
    });

    it('transitions through a complete round', () => {
      const sm = new StateMachine('OMEN', 1);
      const phases: GamePhase[] = [
        'TAXATION', 'DICE', 'ACTIONS', 'PROGRESS', 'GLORY', 'ACHIEVEMENT',
      ];
      for (const p of phases) {
        sm.transition(p);
        expect(sm.currentPhase).toBe(p);
      }
    });

    it('increments roundNumber when looping ACHIEVEMENT → OMEN', () => {
      const sm = new StateMachine('ACHIEVEMENT', 1);
      sm.transition('OMEN');
      expect(sm.roundNumber).toBe(2);
      expect(sm.currentPhase).toBe('OMEN');
    });

    it('does not increment roundNumber for other transitions', () => {
      const sm = new StateMachine('OMEN', 3);
      sm.transition('TAXATION');
      expect(sm.roundNumber).toBe(3);
    });

    it('throws on illegal transition', () => {
      const sm = new StateMachine();
      expect(() => sm.transition('OMEN')).toThrow('Illegal transition: LOBBY → OMEN');
    });

    it('throws when trying ACHIEVEMENT → FINAL_SCORING on round < 9', () => {
      const sm = new StateMachine('ACHIEVEMENT', 5);
      expect(() => sm.transition('FINAL_SCORING')).toThrow('Illegal transition');
    });

    it('throws when trying ACHIEVEMENT → OMEN on round 9', () => {
      const sm = new StateMachine('ACHIEVEMENT', 9);
      expect(() => sm.transition('OMEN')).toThrow('Illegal transition');
    });

    it('completes a full 9-round game', () => {
      const sm = new StateMachine();
      sm.transition('CITY_SELECTION');
      sm.transition('DRAFT_POLITICS');
      sm.transition('OMEN');

      for (let round = 1; round <= 9; round++) {
        expect(sm.roundNumber).toBe(round);
        expect(sm.currentPhase).toBe('OMEN');

        sm.transition('TAXATION');
        sm.transition('DICE');
        sm.transition('ACTIONS');
        sm.transition('PROGRESS');
        sm.transition('GLORY');
        sm.transition('ACHIEVEMENT');

        if (round < 9) {
          sm.transition('OMEN');
        }
      }

      sm.transition('FINAL_SCORING');
      sm.transition('GAME_OVER');
      expect(sm.isGameOver()).toBe(true);
      expect(sm.roundNumber).toBe(9);
    });
  });

  describe('isGameOver', () => {
    it('returns false for non-GAME_OVER phases', () => {
      const phases: GamePhase[] = [
        'LOBBY', 'CITY_SELECTION', 'OMEN', 'TAXATION', 'DICE',
        'ACTIONS', 'PROGRESS', 'GLORY', 'ACHIEVEMENT', 'FINAL_SCORING',
      ];
      for (const p of phases) {
        const sm = new StateMachine(p, 1);
        expect(sm.isGameOver()).toBe(false);
      }
    });

    it('returns true for GAME_OVER', () => {
      const sm = new StateMachine('GAME_OVER', 9);
      expect(sm.isGameOver()).toBe(true);
    });
  });
});
