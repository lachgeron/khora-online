import { describe, it, expect } from 'vitest';
import {
  getNextDevelopment,
  getUnlockedDevelopments,
  collectOngoingDevelopmentEffects,
  applyDevelopmentEffect,
} from './city-abilities';
import { makeTestPlayer, makeTestCityCard } from './test-helpers';
import type { CityCard, CityDevelopment } from '@khora/shared';

const immediateDev: CityDevelopment = {
  id: 'dev-imm',
  name: 'Immediate Dev',
  level: 1,
  knowledgeRequirement: { green: 0, blue: 0, red: 0 },
  drachmaCost: 0,
  effect: { type: 'GAIN_COINS', amount: 2 },
  effectType: 'IMMEDIATE',
};

const ongoingDev: CityDevelopment = {
  id: 'dev-ongoing',
  name: 'Ongoing Dev',
  level: 2,
  knowledgeRequirement: { green: 0, blue: 0, red: 0 },
  drachmaCost: 0,
  effect: { type: 'GAIN_VP', amount: 1 },
  effectType: 'ONGOING',
};

const endGameDev: CityDevelopment = {
  id: 'dev-endgame',
  name: 'End Game Dev',
  level: 3,
  knowledgeRequirement: { green: 1, blue: 0, red: 0 },
  drachmaCost: 2,
  effect: { type: 'GAIN_VP', amount: 3 },
  effectType: 'END_GAME',
};

function makeCityWith3Devs(): CityCard {
  return makeTestCityCard('testcity', {
    developments: [immediateDev, ongoingDev, endGameDev],
  });
}

describe('getNextDevelopment', () => {
  it('returns the first development when player has developmentLevel 0', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 0 });
    const next = getNextDevelopment(city, player);
    expect(next).not.toBeNull();
    expect(next!.id).toBe('dev-imm');
  });

  it('returns the second development when player has developmentLevel 1', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 1 });
    const next = getNextDevelopment(city, player);
    expect(next).not.toBeNull();
    expect(next!.id).toBe('dev-ongoing');
  });

  it('returns the third development when player has developmentLevel 2', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 2 });
    const next = getNextDevelopment(city, player);
    expect(next).not.toBeNull();
    expect(next!.id).toBe('dev-endgame');
  });

  it('returns null when all 3 developments have been unlocked', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 3 });
    const next = getNextDevelopment(city, player);
    expect(next).toBeNull();
  });

  it('returns null for a city with only 1 development when player is at level 1', () => {
    const city = makeTestCityCard('small');
    const player = makeTestPlayer({ developmentLevel: 1 });
    const next = getNextDevelopment(city, player);
    expect(next).toBeNull();
  });
});

describe('getUnlockedDevelopments', () => {
  it('returns empty array when developmentLevel is 0', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 0 });
    expect(getUnlockedDevelopments(city, player)).toHaveLength(0);
  });

  it('returns first development when developmentLevel is 1', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 1 });
    const unlocked = getUnlockedDevelopments(city, player);
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0].id).toBe('dev-imm');
  });

  it('returns first two developments when developmentLevel is 2', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 2 });
    const unlocked = getUnlockedDevelopments(city, player);
    expect(unlocked).toHaveLength(2);
    expect(unlocked[0].id).toBe('dev-imm');
    expect(unlocked[1].id).toBe('dev-ongoing');
  });

  it('returns all three developments when developmentLevel is 3', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 3 });
    const unlocked = getUnlockedDevelopments(city, player);
    expect(unlocked).toHaveLength(3);
  });
});

describe('collectOngoingDevelopmentEffects', () => {
  it('returns empty array when no developments unlocked', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 0 });
    expect(collectOngoingDevelopmentEffects(city, player)).toHaveLength(0);
  });

  it('returns empty array when only IMMEDIATE developments are unlocked', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 1 });
    // Only dev-imm (IMMEDIATE) is unlocked, no ONGOING
    expect(collectOngoingDevelopmentEffects(city, player)).toHaveLength(0);
  });

  it('returns ONGOING effects when ONGOING development is unlocked', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 2 });
    const effects = collectOngoingDevelopmentEffects(city, player);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toEqual(ongoingDev.effect);
  });

  it('returns only ONGOING effects, not END_GAME or IMMEDIATE', () => {
    const city = makeCityWith3Devs();
    const player = makeTestPlayer({ developmentLevel: 3 });
    const effects = collectOngoingDevelopmentEffects(city, player);
    // Only dev-ongoing is ONGOING; dev-imm is IMMEDIATE, dev-endgame is END_GAME
    expect(effects).toHaveLength(1);
    expect(effects[0]).toEqual(ongoingDev.effect);
  });
});

describe('applyDevelopmentEffect', () => {
  it('applies IMMEDIATE development effect to player', () => {
    const player = makeTestPlayer({ coins: 5 });
    const result = applyDevelopmentEffect(player, immediateDev);
    expect(result.coins).toBe(7); // +2 from GAIN_COINS
  });

  it('does not apply ONGOING development effect', () => {
    const player = makeTestPlayer({ victoryPoints: 5 });
    const result = applyDevelopmentEffect(player, ongoingDev);
    expect(result.victoryPoints).toBe(5); // unchanged
  });

  it('does not apply END_GAME development effect', () => {
    const player = makeTestPlayer({ victoryPoints: 5 });
    const result = applyDevelopmentEffect(player, endGameDev);
    expect(result.victoryPoints).toBe(5); // unchanged
  });
});
