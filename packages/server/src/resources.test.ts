import { describe, it, expect } from 'vitest';
import {
  getTrackLevel,
  trackField,
  advanceTrack,
  setTrack,
  hasCoins,
  addCoins,
  subtractCoins,
  hasCitizens,
  addCitizens,
  subtractCitizens,
  addPhilosophyTokens,
  subtractPhilosophyTokens,
  addKnowledgeToken,
  meetsKnowledgeRequirement,
  addVP,
} from './resources';
import { makeTestPlayer, makeTestKnowledgeToken } from './test-helpers';

describe('getTrackLevel', () => {
  it('returns the economy track level', () => {
    const player = makeTestPlayer({ economyTrack: 5 });
    expect(getTrackLevel(player, 'ECONOMY')).toBe(5);
  });

  it('returns the culture track level', () => {
    const player = makeTestPlayer({ cultureTrack: 3 });
    expect(getTrackLevel(player, 'CULTURE')).toBe(3);
  });

  it('returns the military track level', () => {
    const player = makeTestPlayer({ militaryTrack: 7 });
    expect(getTrackLevel(player, 'MILITARY')).toBe(7);
  });

  it('returns the tax track level', () => {
    const player = makeTestPlayer({ taxTrack: 2 });
    expect(getTrackLevel(player, 'TAX')).toBe(2);
  });

  it('returns the glory track level', () => {
    const player = makeTestPlayer({ gloryTrack: 4 });
    expect(getTrackLevel(player, 'GLORY')).toBe(4);
  });

  it('returns the troop track level', () => {
    const player = makeTestPlayer({ troopTrack: 6 });
    expect(getTrackLevel(player, 'TROOP')).toBe(6);
  });

  it('returns the citizen track level', () => {
    const player = makeTestPlayer({ citizenTrack: 3 });
    expect(getTrackLevel(player, 'CITIZEN')).toBe(3);
  });
});

describe('trackField', () => {
  it('returns economyTrack for ECONOMY', () => {
    expect(trackField('ECONOMY')).toBe('economyTrack');
  });

  it('returns cultureTrack for CULTURE', () => {
    expect(trackField('CULTURE')).toBe('cultureTrack');
  });

  it('returns militaryTrack for MILITARY', () => {
    expect(trackField('MILITARY')).toBe('militaryTrack');
  });

  it('returns taxTrack for TAX', () => {
    expect(trackField('TAX')).toBe('taxTrack');
  });

  it('returns gloryTrack for GLORY', () => {
    expect(trackField('GLORY')).toBe('gloryTrack');
  });

  it('returns troopTrack for TROOP', () => {
    expect(trackField('TROOP')).toBe('troopTrack');
  });

  it('returns citizenTrack for CITIZEN', () => {
    expect(trackField('CITIZEN')).toBe('citizenTrack');
  });
});

describe('advanceTrack', () => {
  it('advances economy track by the given amount', () => {
    const player = makeTestPlayer({ economyTrack: 2 });
    const updated = advanceTrack(player, 'ECONOMY', 3);
    expect(updated.economyTrack).toBe(5);
  });

  it('does not mutate the original player', () => {
    const player = makeTestPlayer({ economyTrack: 2 });
    advanceTrack(player, 'ECONOMY', 3);
    expect(player.economyTrack).toBe(2);
  });

  it('preserves all other fields', () => {
    const player = makeTestPlayer({ economyTrack: 2, coins: 10, victoryPoints: 5 });
    const updated = advanceTrack(player, 'ECONOMY', 1);
    expect(updated.coins).toBe(10);
    expect(updated.victoryPoints).toBe(5);
    expect(updated.playerId).toBe('player-1');
  });

  it('caps tax track at 10', () => {
    const player = makeTestPlayer({ taxTrack: 9 });
    const updated = advanceTrack(player, 'TAX', 3);
    expect(updated.taxTrack).toBe(10);
  });

  it('caps glory track at 10', () => {
    const player = makeTestPlayer({ gloryTrack: 9 });
    const updated = advanceTrack(player, 'GLORY', 3);
    expect(updated.gloryTrack).toBe(10);
  });

  it('caps tax and glory milestone rewards at 10', () => {
    const culturePlayer = makeTestPlayer({ cultureTrack: 6, taxTrack: 9 });
    const militaryPlayer = makeTestPlayer({ militaryTrack: 6, gloryTrack: 9 });

    expect(advanceTrack(culturePlayer, 'CULTURE', 1).taxTrack).toBe(10);
    expect(advanceTrack(militaryPlayer, 'MILITARY', 1).gloryTrack).toBe(10);
  });
});

describe('setTrack', () => {
  it('sets a track to a specific value', () => {
    const player = makeTestPlayer({ militaryTrack: 1 });
    const updated = setTrack(player, 'MILITARY', 5);
    expect(updated.militaryTrack).toBe(5);
  });

  it('does not mutate the original player', () => {
    const player = makeTestPlayer({ militaryTrack: 1 });
    setTrack(player, 'MILITARY', 5);
    expect(player.militaryTrack).toBe(1);
  });

  it('caps tax and glory tracks at 10', () => {
    expect(setTrack(makeTestPlayer(), 'TAX', 12).taxTrack).toBe(10);
    expect(setTrack(makeTestPlayer(), 'GLORY', 12).gloryTrack).toBe(10);
  });
});

describe('hasCoins', () => {
  it('returns true when player has exactly the required amount', () => {
    const player = makeTestPlayer({ coins: 5 });
    expect(hasCoins(player, 5)).toBe(true);
  });

  it('returns true when player has more than required', () => {
    const player = makeTestPlayer({ coins: 10 });
    expect(hasCoins(player, 3)).toBe(true);
  });

  it('returns false when player has less than required', () => {
    const player = makeTestPlayer({ coins: 2 });
    expect(hasCoins(player, 5)).toBe(false);
  });

  it('returns true for zero amount check', () => {
    const player = makeTestPlayer({ coins: 0 });
    expect(hasCoins(player, 0)).toBe(true);
  });
});

describe('addCoins', () => {
  it('adds coins without mutating the original', () => {
    const player = makeTestPlayer({ coins: 5 });
    const updated = addCoins(player, 3);
    expect(updated.coins).toBe(8);
    expect(player.coins).toBe(5);
  });

  it('preserves all other fields', () => {
    const player = makeTestPlayer({ coins: 5, citizenTrack: 3, victoryPoints: 7 });
    const updated = addCoins(player, 1);
    expect(updated.citizenTrack).toBe(3);
    expect(updated.victoryPoints).toBe(7);
    expect(updated.playerId).toBe('player-1');
  });
});

describe('subtractCoins', () => {
  it('subtracts coins when sufficient', () => {
    const player = makeTestPlayer({ coins: 10 });
    const result = subtractCoins(player, 4);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.coins).toBe(6);
    }
  });

  it('subtracts to exactly zero', () => {
    const player = makeTestPlayer({ coins: 3 });
    const result = subtractCoins(player, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.coins).toBe(0);
    }
  });

  it('returns error when insufficient coins', () => {
    const player = makeTestPlayer({ coins: 2 });
    const result = subtractCoins(player, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INSUFFICIENT_RESOURCES');
      expect(result.error.message).toContain('coins');
    }
  });

  it('returns error when coins is zero and amount > 0', () => {
    const player = makeTestPlayer({ coins: 0 });
    const result = subtractCoins(player, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INSUFFICIENT_RESOURCES');
    }
  });

  it('does not mutate the original player', () => {
    const player = makeTestPlayer({ coins: 10 });
    subtractCoins(player, 3);
    expect(player.coins).toBe(10);
  });
});

describe('hasCitizens', () => {
  it('returns true when citizenTrack is sufficient', () => {
    const player = makeTestPlayer({ citizenTrack: 5 });
    expect(hasCitizens(player, 3)).toBe(true);
  });

  it('returns false when citizenTrack is insufficient', () => {
    const player = makeTestPlayer({ citizenTrack: 1 });
    expect(hasCitizens(player, 3)).toBe(false);
  });
});

describe('addCitizens', () => {
  it('adds citizen track levels', () => {
    const player = makeTestPlayer({ citizenTrack: 2 });
    const updated = addCitizens(player, 4);
    expect(updated.citizenTrack).toBe(6);
  });
});

describe('subtractCitizens', () => {
  it('subtracts citizen track levels when sufficient', () => {
    const player = makeTestPlayer({ citizenTrack: 5 });
    const result = subtractCitizens(player, 3);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.citizenTrack).toBe(2);
    }
  });

  it('returns error when insufficient citizens', () => {
    const player = makeTestPlayer({ citizenTrack: 1 });
    const result = subtractCitizens(player, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INSUFFICIENT_RESOURCES');
    }
  });
});

describe('addPhilosophyTokens', () => {
  it('adds philosophy tokens', () => {
    const player = makeTestPlayer({ philosophyTokens: 0 });
    const updated = addPhilosophyTokens(player, 3);
    expect(updated.philosophyTokens).toBe(3);
  });
});

describe('subtractPhilosophyTokens', () => {
  it('subtracts philosophy tokens when sufficient', () => {
    const player = makeTestPlayer({ philosophyTokens: 4 });
    const result = subtractPhilosophyTokens(player, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.philosophyTokens).toBe(2);
    }
  });

  it('returns error when insufficient philosophy tokens', () => {
    const player = makeTestPlayer({ philosophyTokens: 1 });
    const result = subtractPhilosophyTokens(player, 3);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INSUFFICIENT_RESOURCES');
    }
  });
});

describe('addKnowledgeToken', () => {
  it('adds a knowledge token to the player collection', () => {
    const player = makeTestPlayer({ knowledgeTokens: [] });
    const token = makeTestKnowledgeToken({ id: 'kt-1', color: 'GREEN' });
    const updated = addKnowledgeToken(player, token);
    expect(updated.knowledgeTokens).toHaveLength(1);
    expect(updated.knowledgeTokens[0].color).toBe('GREEN');
  });

  it('does not mutate the original player', () => {
    const player = makeTestPlayer({ knowledgeTokens: [] });
    const token = makeTestKnowledgeToken();
    addKnowledgeToken(player, token);
    expect(player.knowledgeTokens).toHaveLength(0);
  });

  it('appends to existing tokens', () => {
    const existing = makeTestKnowledgeToken({ id: 'kt-1', color: 'GREEN' });
    const player = makeTestPlayer({ knowledgeTokens: [existing] });
    const newToken = makeTestKnowledgeToken({ id: 'kt-2', color: 'BLUE' });
    const updated = addKnowledgeToken(player, newToken);
    expect(updated.knowledgeTokens).toHaveLength(2);
  });
});

describe('meetsKnowledgeRequirement', () => {
  it('returns true when all requirements are met', () => {
    const player = makeTestPlayer({
      knowledgeTokens: [
        makeTestKnowledgeToken({ id: 'kt-1', color: 'GREEN' }),
        makeTestKnowledgeToken({ id: 'kt-2', color: 'BLUE' }),
      ],
    });
    expect(meetsKnowledgeRequirement(player, { green: 1, blue: 1, red: 0 })).toBe(true);
  });

  it('returns false when a color is missing', () => {
    const player = makeTestPlayer({
      knowledgeTokens: [
        makeTestKnowledgeToken({ id: 'kt-1', color: 'GREEN' }),
      ],
    });
    expect(meetsKnowledgeRequirement(player, { green: 1, blue: 1, red: 0 })).toBe(false);
  });

  it('returns true with zero requirements', () => {
    const player = makeTestPlayer({ knowledgeTokens: [] });
    expect(meetsKnowledgeRequirement(player, { green: 0, blue: 0, red: 0 })).toBe(true);
  });

  it('allows philosophy token pairs to cover shortfall', () => {
    const player = makeTestPlayer({
      knowledgeTokens: [
        makeTestKnowledgeToken({ id: 'kt-1', color: 'GREEN' }),
      ],
      philosophyTokens: 4,
    });
    // Need 1 green (have it) + 1 blue (missing, use 1 philosophy pair = 2 tokens)
    expect(meetsKnowledgeRequirement(player, { green: 1, blue: 1, red: 0 }, 1)).toBe(true);
  });

  it('rejects if not enough philosophy token pairs', () => {
    const player = makeTestPlayer({
      knowledgeTokens: [],
      philosophyTokens: 1,
    });
    // Need 1 green but only 1 philosophy token (need 2 for a pair)
    expect(meetsKnowledgeRequirement(player, { green: 1, blue: 0, red: 0 }, 1)).toBe(false);
  });
});

describe('addVP', () => {
  it('adds VP to the player score track', () => {
    const player = makeTestPlayer({ victoryPoints: 10 });
    const updated = addVP(player, 5);
    expect(updated.victoryPoints).toBe(15);
  });

  it('does not mutate the original player', () => {
    const player = makeTestPlayer({ victoryPoints: 10 });
    addVP(player, 5);
    expect(player.victoryPoints).toBe(10);
  });
});
