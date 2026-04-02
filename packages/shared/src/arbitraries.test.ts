import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  arbTrackLevel,
  arbResourceAmount,
  arbDiceValue,
  arbActionType,
  arbGamePhase,
  arbGameEffect,
  arbGloryCondition,
  arbScoringRule,
  arbCityCard,
  arbEventCard,
  arbPoliticsCard,
  arbDiceAssignment,
  arbPlayerState,
  arbGameState,
  arbKnowledgeToken,
} from './arbitraries';

describe('arbitraries', () => {
  it('arbTrackLevel generates values in [0, 15]', () => {
    fc.assert(
      fc.property(arbTrackLevel, (level) => {
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(15);
        expect(Number.isInteger(level)).toBe(true);
      }),
    );
  });

  it('arbResourceAmount generates non-negative values <= 50', () => {
    fc.assert(
      fc.property(arbResourceAmount, (amount) => {
        expect(amount).toBeGreaterThanOrEqual(0);
        expect(amount).toBeLessThanOrEqual(50);
      }),
    );
  });

  it('arbDiceValue generates values in [1, 6]', () => {
    fc.assert(
      fc.property(arbDiceValue, (val) => {
        expect(val).toBeGreaterThanOrEqual(1);
        expect(val).toBeLessThanOrEqual(6);
      }),
    );
  });

  it('arbActionType generates valid action types', () => {
    const valid = new Set([
      'PHILOSOPHY', 'LEGISLATION', 'CULTURE', 'TRADE',
      'MILITARY', 'POLITICS', 'DEVELOPMENT',
    ]);
    fc.assert(
      fc.property(arbActionType, (t) => {
        expect(valid.has(t)).toBe(true);
      }),
    );
  });

  it('arbGamePhase generates valid phases', () => {
    const valid = new Set([
      'LOBBY', 'CITY_SELECTION', 'DRAFT_POLITICS', 'OMEN', 'TAXATION', 'DICE',
      'ACTIONS', 'PROGRESS', 'GLORY', 'ACHIEVEMENT',
      'FINAL_SCORING', 'GAME_OVER',
    ]);
    fc.assert(
      fc.property(arbGamePhase, (p) => {
        expect(valid.has(p)).toBe(true);
      }),
    );
  });

  it('arbGameEffect generates valid effect objects', () => {
    fc.assert(
      fc.property(arbGameEffect, (e) => {
        expect(e).toHaveProperty('type');
        expect(typeof e.type).toBe('string');
      }),
    );
  });

  it('arbGloryCondition has a callable evaluate stub', () => {
    fc.assert(
      fc.property(arbGloryCondition, (gc) => {
        expect(typeof gc.evaluate).toBe('function');
        expect(gc.evaluate({} as any, [])).toBe(true);
        expect(gc.description.length).toBeGreaterThan(0);
      }),
    );
  });

  it('arbScoringRule has a callable calculate stub', () => {
    fc.assert(
      fc.property(arbScoringRule, (sr) => {
        expect(typeof sr.calculate).toBe('function');
        expect(sr.calculate({} as any)).toBe(0);
      }),
    );
  });

  it('arbCityCard has valid starting tracks', () => {
    fc.assert(
      fc.property(arbCityCard, (city) => {
        expect(city.startingCoins).toBeGreaterThanOrEqual(0);
        expect(city.startingTracks.economy).toBeGreaterThanOrEqual(0);
        expect(city.startingTracks.economy).toBeLessThanOrEqual(3);
        expect(city.startingTracks.culture).toBeGreaterThanOrEqual(0);
        expect(city.startingTracks.culture).toBeLessThanOrEqual(3);
        expect(city.startingTracks.military).toBeGreaterThanOrEqual(0);
        expect(city.startingTracks.military).toBeLessThanOrEqual(3);
        expect(city.startingTracks.citizen).toBeGreaterThanOrEqual(2);
        expect(city.developments.length).toBe(3);
      }),
    );
  });

  it('arbEventCard has valid structure with glory condition', () => {
    fc.assert(
      fc.property(arbEventCard, (card) => {
        expect(card.id).toBeTruthy();
        expect(card.name.length).toBeGreaterThan(0);
        expect(typeof card.gloryCondition.evaluate).toBe('function');
      }),
    );
  });

  it('arbPoliticsCard has valid cost and type', () => {
    const validTypes = new Set(['IMMEDIATE', 'ONGOING', 'END_GAME']);
    fc.assert(
      fc.property(arbPoliticsCard, (card) => {
        expect(card.cost).toBeGreaterThanOrEqual(0);
        expect(card.cost).toBeLessThanOrEqual(10);
        expect(validTypes.has(card.type)).toBe(true);
        expect(card.knowledgeRequirement).toBeDefined();
      }),
    );
  });

  it('arbKnowledgeToken has valid color and type', () => {
    const validColors = new Set(['GREEN', 'BLUE', 'RED']);
    const validTypes = new Set(['MAJOR', 'MINOR']);
    fc.assert(
      fc.property(arbKnowledgeToken, (token) => {
        expect(validColors.has(token.color)).toBe(true);
        expect(validTypes.has(token.tokenType)).toBe(true);
      }),
    );
  });

  it('arbDiceAssignment has valid slotIndex, actionType, dieValue', () => {
    fc.assert(
      fc.property(arbDiceAssignment, (da) => {
        expect([0, 1, 2]).toContain(da.slotIndex);
        expect(da.dieValue).toBeGreaterThanOrEqual(1);
        expect(da.dieValue).toBeLessThanOrEqual(6);
      }),
    );
  });

  it('arbPlayerState has valid tracks and non-negative resources', () => {
    fc.assert(
      fc.property(arbPlayerState, (ps) => {
        expect(ps.economyTrack).toBeGreaterThanOrEqual(0);
        expect(ps.cultureTrack).toBeGreaterThanOrEqual(0);
        expect(ps.militaryTrack).toBeGreaterThanOrEqual(0);
        expect(ps.taxTrack).toBeGreaterThanOrEqual(0);
        expect(ps.gloryTrack).toBeGreaterThanOrEqual(0);
        expect(ps.troopTrack).toBeGreaterThanOrEqual(0);
        expect(ps.citizenTrack).toBeGreaterThanOrEqual(0);
        expect(ps.coins).toBeGreaterThanOrEqual(0);
        expect(ps.philosophyTokens).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(ps.knowledgeTokens)).toBe(true);
      }),
    );
  });

  it('arbGameState has 1-4 players, roundNumber 1-9, valid phase', () => {
    fc.assert(
      fc.property(arbGameState, (gs) => {
        expect(gs.players.length).toBeGreaterThanOrEqual(1);
        expect(gs.players.length).toBeLessThanOrEqual(4);
        expect(gs.roundNumber).toBeGreaterThanOrEqual(1);
        expect(gs.roundNumber).toBeLessThanOrEqual(9);
        expect(gs.claimedAchievements).toBeInstanceOf(Map);
        expect(gs.disconnectedPlayers).toBeInstanceOf(Map);
      }),
    );
  });
});
