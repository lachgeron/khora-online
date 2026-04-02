import { describe, it, expect } from 'vitest';
import { formatGameState, parseGameState } from './pretty-printer';
import { makeTestPlayer, makeTestGameState } from './test-helpers';
import type { GameState, PlayerState } from '@khora/shared';

function makePlayer(id: string): PlayerState {
  return makeTestPlayer({
    playerId: id,
    playerName: `Player ${id}`,
    cityId: `city-${id}`,
    coins: 10,
    knowledgeTokens: [],
    troopTrack: 3,
    citizenTrack: 5,
    economyTrack: 4,
    cultureTrack: 2,
    militaryTrack: 1,
    gloryTrack: 7,
    victoryPoints: 12,
    isConnected: true,
  });
}

function makeTestState(): GameState {
  return makeTestGameState({
    roundNumber: 3,
    currentPhase: 'ACTIONS',
    players: [makePlayer('p1'), makePlayer('p2')],
    currentEvent: {
      id: 'evt-1',
      name: 'Great Storm',
      immediateEffect: null,
      gloryCondition: { type: 'CUSTOM', evaluate: () => true, description: 'test' },
      penaltyEffect: null,
    },
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
  });
}

describe('pretty-printer', () => {
  describe('formatGameState', () => {
    it('includes game metadata', () => {
      const text = formatGameState(makeTestState());
      expect(text).toContain('GameId: game-1');
      expect(text).toContain('Round: 3');
      expect(text).toContain('Phase: ACTIONS');
    });

    it('includes current event info', () => {
      const text = formatGameState(makeTestState());
      expect(text).toContain('EventId: evt-1');
      expect(text).toContain('EventName: Great Storm');
    });

    it('shows None for null event', () => {
      const state = makeTestState();
      state.currentEvent = null;
      const text = formatGameState(state);
      expect(text).toContain('None');
    });

    it('includes player summaries', () => {
      const text = formatGameState(makeTestState());
      expect(text).toContain('Player: p1');
      expect(text).toContain('Name: Player p1');
      expect(text).toContain('Coins: 10');
      expect(text).toContain('EconomyTrack: 4');
      expect(text).toContain('VictoryPoints: 12');
    });

    it('includes deck sizes', () => {
      const text = formatGameState(makeTestState());
      expect(text).toContain('DeckSize: 0');
    });
  });

  describe('parseGameState', () => {
    it('reconstructs basic fields from formatted text', () => {
      const state = makeTestState();
      const text = formatGameState(state);
      const parsed = parseGameState(text);
      expect(parsed.gameId).toBe('game-1');
      expect(parsed.roundNumber).toBe(3);
      expect(parsed.currentPhase).toBe('ACTIONS');
    });

    it('reconstructs player data', () => {
      const state = makeTestState();
      const text = formatGameState(state);
      const parsed = parseGameState(text);
      expect(parsed.players).toHaveLength(2);
      expect(parsed.players[0].playerId).toBe('p1');
      expect(parsed.players[0].coins).toBe(10);
      expect(parsed.players[0].economyTrack).toBe(4);
    });

    it('reconstructs current event', () => {
      const state = makeTestState();
      const text = formatGameState(state);
      const parsed = parseGameState(text);
      expect(parsed.currentEvent).not.toBeNull();
      expect(parsed.currentEvent!.id).toBe('evt-1');
      expect(parsed.currentEvent!.name).toBe('Great Storm');
    });
  });

  describe('round-trip (format -> parse -> format)', () => {
    it('produces identical text on second format', () => {
      const state = makeTestState();
      const text1 = formatGameState(state);
      const parsed = parseGameState(text1);
      const text2 = formatGameState(parsed);
      expect(text2).toBe(text1);
    });

    it('works with null event', () => {
      const state = makeTestState();
      state.currentEvent = null;
      const text1 = formatGameState(state);
      const parsed = parseGameState(text1);
      const text2 = formatGameState(parsed);
      expect(text2).toBe(text1);
    });
  });
});
