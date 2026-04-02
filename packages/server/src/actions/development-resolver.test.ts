import { describe, it, expect, beforeEach } from 'vitest';
import { DevelopmentResolver } from './development-resolver';
import { makeTestPlayer, makeTestGameState, makeTestCityCard } from '../test-helpers';
import type { CityDevelopment } from '@khora/shared';

function makeDev(level: number, overrides: Partial<CityDevelopment> = {}): CityDevelopment {
  return {
    id: `dev-${level}`,
    name: `Development ${level}`,
    level,
    knowledgeRequirement: { green: 0, blue: 0, red: 0 },
    drachmaCost: 3,
    effect: { type: 'GAIN_COINS', amount: 1 },
    effectType: 'IMMEDIATE',
    ...overrides,
  };
}

describe('DevelopmentResolver', () => {
  const resolver = new DevelopmentResolver();

  const cityWithDevs = makeTestCityCard('city-1', {
    developments: [
      makeDev(1, { drachmaCost: 2 }),
      makeDev(2, { drachmaCost: 4 }),
      makeDev(3, { drachmaCost: 6 }),
    ],
  });

  beforeEach(() => {
    resolver.setCityCards([cityWithDevs]);
  });

  describe('metadata', () => {
    it('has actionNumber 6', () => {
      expect(resolver.actionNumber).toBe(6);
    });

    it('has actionType DEVELOPMENT', () => {
      expect(resolver.actionType).toBe('DEVELOPMENT');
    });
  });

  describe('canPerform', () => {
    it('returns citizenCost 0 for die value >= 6', () => {
      const player = makeTestPlayer({ cityId: 'city-1', coins: 20, developmentLevel: 0 });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.canPerform(state, 'player-1', 6);
      expect(result.citizenCost).toBe(0);
    });

    it('returns citizenCost 5 for die value 1', () => {
      const player = makeTestPlayer({ cityId: 'city-1', coins: 20, developmentLevel: 0 });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.canPerform(state, 'player-1', 1);
      expect(result.citizenCost).toBe(5);
    });

    it('returns citizenCost 2 for die value 4', () => {
      const player = makeTestPlayer({ cityId: 'city-1', coins: 20, developmentLevel: 0 });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.canPerform(state, 'player-1', 4);
      expect(result.citizenCost).toBe(2);
    });

    it('returns canPerform false when max developments reached', () => {
      const player = makeTestPlayer({ cityId: 'city-1', coins: 20, developmentLevel: 3 });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.canPerform(state, 'player-1', 6);
      expect(result.canPerform).toBe(false);
    });

    it('returns canPerform false when insufficient coins', () => {
      const player = makeTestPlayer({ cityId: 'city-1', coins: 0, developmentLevel: 0 });
      const state = makeTestGameState({ players: [player] });
      const result = resolver.canPerform(state, 'player-1', 6);
      expect(result.canPerform).toBe(false);
    });
  });

  describe('resolve', () => {
    it('unlocks development and deducts coins', () => {
      const player = makeTestPlayer({ cityId: 'city-1', coins: 10, developmentLevel: 0 });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].developmentLevel).toBe(1);
        expect(result.value.players[0].coins).toBe(9); // 10 - 2 (cost) + 1 (GAIN_COINS effect)
      }
    });

    it('unlocks second development in sequence', () => {
      const player = makeTestPlayer({ cityId: 'city-1', coins: 10, developmentLevel: 1 });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].developmentLevel).toBe(2);
        expect(result.value.players[0].coins).toBe(7); // 10 - 4 (cost) + 1 (GAIN_COINS effect)
      }
    });

    it('rejects when max developments already reached', () => {
      const player = makeTestPlayer({ cityId: 'city-1', coins: 20, developmentLevel: 3 });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('MAX_DEVELOPMENTS_REACHED');
      }
    });

    it('returns INSUFFICIENT_RESOURCES when player cannot afford', () => {
      const player = makeTestPlayer({ cityId: 'city-1', coins: 1, developmentLevel: 0 });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSUFFICIENT_RESOURCES');
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
      const p1 = makeTestPlayer({ playerId: 'player-1', cityId: 'city-1', coins: 10, developmentLevel: 0 });
      const p2 = makeTestPlayer({ playerId: 'player-2', coins: 15, developmentLevel: 0 });
      const state = makeTestGameState({ players: [p1, p2] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[1].coins).toBe(15);
        expect(result.value.players[1].developmentLevel).toBe(0);
      }
    });

    it('does not mutate the original state', () => {
      const player = makeTestPlayer({ cityId: 'city-1', coins: 10, developmentLevel: 0 });
      const state = makeTestGameState({ players: [player] });

      resolver.resolve(state, 'player-1', {});

      expect(state.players[0].developmentLevel).toBe(0);
      expect(state.players[0].coins).toBe(10);
    });

    it('rejects when knowledge requirements not met', () => {
      const cityWithKnReq = makeTestCityCard('city-kr', {
        developments: [
          makeDev(1, { drachmaCost: 2, knowledgeRequirement: { green: 1, blue: 0, red: 0 } }),
        ],
      });
      resolver.setCityCards([cityWithKnReq]);

      const player = makeTestPlayer({
        cityId: 'city-kr',
        coins: 10,
        developmentLevel: 0,
        knowledgeTokens: [],
      });
      const state = makeTestGameState({ players: [player] });

      const result = resolver.resolve(state, 'player-1', {});

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INSUFFICIENT_KNOWLEDGE');
      }
    });
  });
});
