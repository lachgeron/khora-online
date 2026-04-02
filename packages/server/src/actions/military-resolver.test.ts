import { describe, it, expect } from 'vitest';
import { MilitaryResolver } from './military-resolver';
import { makeTestPlayer, makeTestGameState, makeTestKnowledgeToken } from '../test-helpers';

describe('MilitaryResolver', () => {
  const resolver = new MilitaryResolver();

  describe('metadata', () => {
    it('has actionNumber 4', () => {
      expect(resolver.actionNumber).toBe(4);
    });

    it('has actionType MILITARY', () => {
      expect(resolver.actionType).toBe('MILITARY');
    });
  });

  describe('canPerform', () => {
    it('returns citizenCost 0 for die values >= 4', () => {
      const state = makeTestGameState();
      for (let die = 4; die <= 6; die++) {
        const result = resolver.canPerform(state, 'player-1', die);
        expect(result.canPerform).toBe(true);
        expect(result.citizenCost).toBe(0);
      }
    });

    it('returns citizenCost 1 for die value 3', () => {
      const state = makeTestGameState();
      const result = resolver.canPerform(state, 'player-1', 3);
      expect(result.citizenCost).toBe(1);
    });

    it('returns citizenCost 3 for die value 1', () => {
      const state = makeTestGameState();
      const result = resolver.canPerform(state, 'player-1', 1);
      expect(result.citizenCost).toBe(3);
    });
  });

  describe('resolve', () => {
    it('gains troops equal to military track level', () => {
      const player = makeTestPlayer({ troopTrack: 2, militaryTrack: 3 });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.resolve(state, 'player-1', {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].troopTrack).toBe(5); // 2 + 3
      }
    });

    it('gains 0 troops when military track is 0', () => {
      const player = makeTestPlayer({ troopTrack: 3, militaryTrack: 0 });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.resolve(state, 'player-1', {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].troopTrack).toBe(3); // 3 + 0
      }
    });

    it('optionally explores a knowledge token', () => {
      const token = makeTestKnowledgeToken({
        id: 'kt-central-1',
        color: 'GREEN',
        tokenType: 'MAJOR',
        militaryRequirement: 0,
        skullValue: 0,
      });
      const player = makeTestPlayer({ troopTrack: 1, militaryTrack: 3 });
      const state = makeTestGameState({
        players: [player],
        centralBoardTokens: [token],
      });

      const result = resolver.resolve(state, 'player-1', { explorationTokenId: 'kt-central-1' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Player should have gained the knowledge token
        expect(result.value.players[0].knowledgeTokens.length).toBeGreaterThanOrEqual(1);
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
      const p1 = makeTestPlayer({ playerId: 'player-1', troopTrack: 3, militaryTrack: 2 });
      const p2 = makeTestPlayer({ playerId: 'player-2', militaryTrack: 5 });
      const state = makeTestGameState({ players: [p1, p2] });
      const result = resolver.resolve(state, 'player-1', {});
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[1].militaryTrack).toBe(5);
      }
    });

    it('does not mutate the original state', () => {
      const player = makeTestPlayer({ troopTrack: 2, militaryTrack: 3 });
      const state = makeTestGameState({ players: [player] });
      resolver.resolve(state, 'player-1', {});
      expect(state.players[0].militaryTrack).toBe(3);
    });
  });
});
