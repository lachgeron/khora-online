import { describe, it, expect } from 'vitest';
import { TaxationPhaseManager } from './taxation-phase';
import { makeTestPlayer, makeTestGameState } from '../test-helpers';

describe('TaxationPhaseManager', () => {
  const manager = new TaxationPhaseManager();

  describe('onEnter', () => {
    it('grants coins equal to tax track level (Req 5.1)', () => {
      const player = makeTestPlayer({ taxTrack: 3, coins: 10 });
      const state = makeTestGameState({ currentPhase: 'TAXATION' as any, players: [player] });

      const result = manager.onEnter(state);

      expect(result.players[0].coins).toBe(13); // 10 + 3
    });

    it('grants 0 coins when tax track is 0', () => {
      const player = makeTestPlayer({ taxTrack: 0, coins: 5 });
      const state = makeTestGameState({ currentPhase: 'TAXATION' as any, players: [player] });

      const result = manager.onEnter(state);

      expect(result.players[0].coins).toBe(5);
    });

    it('applies to all players independently (Req 5.4)', () => {
      const p1 = makeTestPlayer({ playerId: 'p1', taxTrack: 2, coins: 5 });
      const p2 = makeTestPlayer({ playerId: 'p2', taxTrack: 5, coins: 10 });
      const state = makeTestGameState({ currentPhase: 'TAXATION' as any, players: [p1, p2] });

      const result = manager.onEnter(state);

      expect(result.players[0].coins).toBe(7);  // 5 + 2
      expect(result.players[1].coins).toBe(15); // 10 + 5
    });

    it('does not mutate the original state', () => {
      const player = makeTestPlayer({ taxTrack: 3, coins: 5 });
      const state = makeTestGameState({ currentPhase: 'TAXATION' as any, players: [player] });

      manager.onEnter(state);

      expect(state.players[0].coins).toBe(5);
    });

    it('does not modify other resources (knowledgeTokens, troopTrack, VP)', () => {
      const player = makeTestPlayer({
        taxTrack: 4,
        knowledgeTokens: [{ id: 'kt-1', color: 'GREEN', tokenType: 'MINOR', militaryRequirement: 0, skullValue: 0 }],
        troopTrack: 3,
        victoryPoints: 12,
      });
      const state = makeTestGameState({ currentPhase: 'TAXATION' as any, players: [player] });

      const result = manager.onEnter(state);

      expect(result.players[0].knowledgeTokens).toHaveLength(1);
      expect(result.players[0].troopTrack).toBe(3);
      expect(result.players[0].victoryPoints).toBe(12);
    });

    it('handles high tax track levels', () => {
      const player = makeTestPlayer({ taxTrack: 7, coins: 0 });
      const state = makeTestGameState({ currentPhase: 'TAXATION' as any, players: [player] });

      const result = manager.onEnter(state);

      expect(result.players[0].coins).toBe(7);
    });
  });

  describe('handleDecision', () => {
    it('returns WRONG_PHASE error for any decision', () => {
      const state = makeTestGameState({ currentPhase: 'TAXATION' as any });
      const result = manager.handleDecision(state, 'player-1', { type: 'SKIP_PHASE' });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('WRONG_PHASE');
      }
    });
  });

  describe('isComplete', () => {
    it('always returns true', () => {
      const state = makeTestGameState({ currentPhase: 'TAXATION' as any });
      expect(manager.isComplete(state)).toBe(true);
    });
  });

  describe('autoResolve', () => {
    it('returns the state unchanged', () => {
      const state = makeTestGameState({ currentPhase: 'TAXATION' as any });
      const result = manager.autoResolve(state, 'player-1');
      expect(result).toEqual(state);
    });
  });
});
