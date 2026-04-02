import { describe, it, expect, beforeEach } from 'vitest';
import { CitySelectionManager } from './city-selection';
import { makeTestCityCard } from './test-helpers';
import type { CityCard, PlayerInfo } from '@khora/shared';

const CITIES: CityCard[] = [
  makeTestCityCard('athens', {
    name: 'Athens',
    startingCoins: 4,
    startingTracks: { economy: 2, culture: 1, military: 0, tax: 0, glory: 0, troop: 0, citizen: 3 },
  }),
  makeTestCityCard('sparta', {
    name: 'Sparta',
    startingCoins: 2,
    startingTracks: { economy: 0, culture: 0, military: 3, tax: 0, glory: 0, troop: 3, citizen: 1 },
  }),
  makeTestCityCard('corinth', {
    name: 'Corinth',
    startingCoins: 5,
    startingTracks: { economy: 3, culture: 0, military: 1, tax: 0, glory: 0, troop: 1, citizen: 2 },
  }),
  makeTestCityCard('thebes', {
    name: 'Thebes',
    startingCoins: 3,
    startingTracks: { economy: 1, culture: 2, military: 1, tax: 0, glory: 0, troop: 2, citizen: 3 },
  }),
];

const PLAYERS: PlayerInfo[] = [
  { playerId: 'p1', playerName: 'Alice' },
  { playerId: 'p2', playerName: 'Bob' },
  { playerId: 'p3', playerName: 'Carol' },
];

describe('CitySelectionManager', () => {
  let manager: CitySelectionManager;

  beforeEach(() => {
    manager = new CitySelectionManager(CITIES, PLAYERS);
  });

  describe('getAvailableCities', () => {
    it('returns all cities initially', () => {
      expect(manager.getAvailableCities()).toHaveLength(4);
    });

    it('excludes selected cities', () => {
      manager.selectCity('p1', 'athens');
      const available = manager.getAvailableCities();
      expect(available).toHaveLength(3);
      expect(available.map(c => c.id)).not.toContain('athens');
    });
  });

  describe('selectCity', () => {
    it('allows a valid selection', () => {
      const result = manager.selectCity('p1', 'athens');
      expect(result.ok).toBe(true);
    });

    it('records the selection in getSelections', () => {
      manager.selectCity('p1', 'athens');
      const selections = manager.getSelections();
      expect(selections.get('p1')).toBe('athens');
    });

    it('rejects selection of an already-taken city', () => {
      manager.selectCity('p1', 'athens');
      const result = manager.selectCity('p2', 'athens');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CITY_TAKEN');
      }
    });

    it('rejects double selection by the same player', () => {
      manager.selectCity('p1', 'athens');
      const result = manager.selectCity('p1', 'sparta');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DUPLICATE_ACTION');
      }
    });

    it('rejects selection by unknown player', () => {
      const result = manager.selectCity('unknown', 'athens');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLAYER_NOT_FOUND');
      }
    });

    it('rejects selection of non-existent city', () => {
      const result = manager.selectCity('p1', 'atlantis');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_DECISION');
      }
    });
  });

  describe('autoAssign', () => {
    it('assigns an available city to the player', () => {
      manager.selectCity('p1', 'athens');
      const result = manager.autoAssign('p2');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).not.toBe('athens');
        expect(['sparta', 'corinth', 'thebes']).toContain(result.value);
      }
    });

    it('records the auto-assigned selection', () => {
      const result = manager.autoAssign('p1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(manager.getSelections().get('p1')).toBe(result.value);
      }
    });

    it('rejects auto-assign for player who already selected', () => {
      manager.selectCity('p1', 'athens');
      const result = manager.autoAssign('p1');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DUPLICATE_ACTION');
      }
    });

    it('rejects auto-assign for unknown player', () => {
      const result = manager.autoAssign('unknown');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PLAYER_NOT_FOUND');
      }
    });

    it('never assigns a taken city', () => {
      // Take 3 of 4 cities, auto-assign should give the remaining one
      manager.selectCity('p1', 'athens');
      manager.selectCity('p2', 'sparta');

      // Create a new manager with only 3 cities and 3 players to force the last one
      const smallManager = new CitySelectionManager(
        [CITIES[0], CITIES[1], CITIES[2]],
        [PLAYERS[0], PLAYERS[1], PLAYERS[2]],
      );
      smallManager.selectCity('p1', 'athens');
      smallManager.selectCity('p2', 'sparta');
      const result = smallManager.autoAssign('p3');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('corinth');
      }
    });
  });

  describe('initializePlayerState', () => {
    it('creates player state matching city card starting values', () => {
      const athens = CITIES[0];
      const state = manager.initializePlayerState(PLAYERS[0], athens);

      expect(state.playerId).toBe('p1');
      expect(state.playerName).toBe('Alice');
      expect(state.cityId).toBe('athens');

      // Resources match city card (plus 1st development immediate effect if applicable)
      // The default test city dev-1 gives GAIN_COINS 1, so coins = startingCoins + 1
      const dev1Effect = athens.developments[0];
      const expectedCoins = dev1Effect?.effectType === 'IMMEDIATE' && dev1Effect.effect.type === 'GAIN_COINS'
        ? athens.startingCoins + dev1Effect.effect.amount
        : athens.startingCoins;
      expect(state.coins).toBe(expectedCoins);

      // Tracks match city card
      expect(state.economyTrack).toBe(athens.startingTracks.economy);
      expect(state.cultureTrack).toBe(athens.startingTracks.culture);
      expect(state.militaryTrack).toBe(athens.startingTracks.military);
      expect(state.taxTrack).toBe(athens.startingTracks.tax);
      expect(state.gloryTrack).toBe(athens.startingTracks.glory);
      expect(state.troopTrack).toBe(athens.startingTracks.troop);
      expect(state.citizenTrack).toBe(athens.startingTracks.citizen);
    });

    it('initializes scoring and round state to defaults', () => {
      const state = manager.initializePlayerState(PLAYERS[0], CITIES[0]);

      expect(state.victoryPoints).toBe(0);
      expect(state.diceRoll).toBeNull();
      expect(state.actionSlots).toEqual([null, null, null]);
      expect(state.handCards).toEqual([]);
      expect(state.playedCards).toEqual([]);
      expect(state.isConnected).toBe(true);
    });
  });

  describe('isComplete', () => {
    it('returns false when no players have selected', () => {
      expect(manager.isComplete()).toBe(false);
    });

    it('returns false when some players have selected', () => {
      manager.selectCity('p1', 'athens');
      expect(manager.isComplete()).toBe(false);
    });

    it('returns true when all players have selected', () => {
      manager.selectCity('p1', 'athens');
      manager.selectCity('p2', 'sparta');
      manager.selectCity('p3', 'corinth');
      expect(manager.isComplete()).toBe(true);
    });
  });

  describe('getSelections', () => {
    it('returns empty map initially', () => {
      expect(manager.getSelections().size).toBe(0);
    });

    it('returns a copy (not a reference)', () => {
      manager.selectCity('p1', 'athens');
      const selections = manager.getSelections();
      selections.set('hacker', 'thebes');
      expect(manager.getSelections().size).toBe(1);
    });
  });
});
