/**
 * Resource and track transaction helpers for Khora Online.
 *
 * All functions are pure — they return new PlayerState objects
 * rather than mutating the input.
 */

import type { PlayerState, TrackType, KnowledgeToken, KnowledgeRequirement } from '@khora/shared';
import type { Result, GameError } from '@khora/shared';

/**
 * Returns the track level for a given TrackType.
 */
export function getTrackLevel(player: PlayerState, track: TrackType): number {
  switch (track) {
    case 'ECONOMY': return player.economyTrack;
    case 'CULTURE': return player.cultureTrack;
    case 'MILITARY': return player.militaryTrack;
    case 'TAX': return player.taxTrack;
    case 'GLORY': return player.gloryTrack;
    case 'TROOP': return player.troopTrack;
    case 'CITIZEN': return player.citizenTrack;
  }
}

/**
 * Returns the PlayerState field name for a TrackType.
 */
export function trackField(track: TrackType): keyof PlayerState {
  switch (track) {
    case 'ECONOMY': return 'economyTrack';
    case 'CULTURE': return 'cultureTrack';
    case 'MILITARY': return 'militaryTrack';
    case 'TAX': return 'taxTrack';
    case 'GLORY': return 'gloryTrack';
    case 'TROOP': return 'troopTrack';
    case 'CITIZEN': return 'citizenTrack';
  }
}

/**
 * Advances a track by the given amount. Progress tracks (Economy, Culture)
 * are soft-capped, while Military and Citizen can temporarily exceed their max.
 * Automatically applies milestone rewards for Economy, Culture, and Military.
 */
export function advanceTrack(player: PlayerState, track: TrackType, amount: number): PlayerState {
  const field = trackField(track);
  const oldLevel = player[field] as number;
  let newLevel = oldLevel + amount;

  // Cap progress tracks at 7
  if (track === 'ECONOMY' || track === 'CULTURE' || track === 'MILITARY') {
    newLevel = Math.min(newLevel, 7);
  }

  // Cap citizen track at 15
  if (track === 'CITIZEN') {
    newLevel = Math.min(newLevel, MAX_CITIZEN_TRACK);
  }

  // Cap troop track at 15
  if (track === 'TROOP') {
    newLevel = Math.min(newLevel, MAX_TROOP_TRACK);
  }

  // No track can go below 0
  newLevel = Math.max(0, newLevel);

  let updated = { ...player, [field]: newLevel };

  // Apply milestone rewards for each level crossed
  if (track === 'ECONOMY' || track === 'CULTURE' || track === 'MILITARY') {
    const rewards = TRACK_MILESTONES[track] ?? {};
    for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
      const reward = rewards[lvl];
      if (reward) {
        updated = applyMilestone(updated, reward);
      }
    }
  }

  return updated;
}

interface Milestone { citizens?: number; vp?: number; taxes?: number; glory?: number }

const MAX_CITIZEN_TRACK = 15;
const MAX_TROOP_TRACK = 15;

function applyMilestone(p: PlayerState, m: Milestone): PlayerState {
  let updated = p;
  if (m.citizens) updated = { ...updated, citizenTrack: Math.min(updated.citizenTrack + m.citizens, MAX_CITIZEN_TRACK) };
  if (m.vp) updated = { ...updated, victoryPoints: updated.victoryPoints + m.vp };
  if (m.taxes) updated = { ...updated, taxTrack: updated.taxTrack + m.taxes };
  if (m.glory) updated = { ...updated, gloryTrack: updated.gloryTrack + m.glory };
  return updated;
}

const TRACK_MILESTONES: Record<string, Record<number, Milestone>> = {
  ECONOMY: {
    2: { citizens: 3 },
    3: { citizens: 3 },
    4: { vp: 5 },
    5: { citizens: 5 },
    7: { vp: 10 },
  },
  CULTURE: {
    3: { taxes: 1 },
    // Level 4: unlock third die — handled by THIRD_DIE_CULTURE_LEVEL constant
    5: { taxes: 1 },
    6: { taxes: 1 },
    7: { taxes: 2 },
  },
  MILITARY: {
    2: { glory: 1 },
    4: { glory: 1 },
    6: { glory: 1 },
    7: { glory: 2 },
  },
};

/**
 * Sets a track to a specific value.
 */
export function setTrack(player: PlayerState, track: TrackType, value: number): PlayerState {
  const field = trackField(track);
  return { ...player, [field]: value };
}

/**
 * Checks whether a player has at least `amount` coins.
 */
export function hasCoins(player: PlayerState, amount: number): boolean {
  return player.coins >= amount;
}

/**
 * Adds coins to a player. Returns a new PlayerState.
 */
export function addCoins(player: PlayerState, amount: number): PlayerState {
  return { ...player, coins: player.coins + amount };
}

/**
 * Subtracts coins from a player.
 * Returns an error if the player has insufficient coins.
 */
export function subtractCoins(
  player: PlayerState,
  amount: number,
): Result<PlayerState, GameError> {
  if (player.coins < amount) {
    return {
      ok: false,
      error: {
        code: 'INSUFFICIENT_RESOURCES',
        message: `Cannot spend ${amount} coins: only ${player.coins} available`,
      },
    };
  }
  return { ok: true, value: { ...player, coins: player.coins - amount } };
}

/**
 * Checks whether a player has at least `amount` citizen track levels.
 */
export function hasCitizens(player: PlayerState, amount: number): boolean {
  return player.citizenTrack >= amount;
}

/**
 * Adds citizens (citizen track levels) to a player. Capped at 15.
 */
export function addCitizens(player: PlayerState, amount: number): PlayerState {
  return { ...player, citizenTrack: Math.min(player.citizenTrack + amount, MAX_CITIZEN_TRACK) };
}

/**
 * Subtracts citizen track levels from a player.
 */
export function subtractCitizens(
  player: PlayerState,
  amount: number,
): Result<PlayerState, GameError> {
  if (player.citizenTrack < amount) {
    return {
      ok: false,
      error: {
        code: 'INSUFFICIENT_RESOURCES',
        message: `Cannot spend ${amount} citizens: only ${player.citizenTrack} available`,
      },
    };
  }
  return { ok: true, value: { ...player, citizenTrack: player.citizenTrack - amount } };
}

/**
 * Adds philosophy tokens to a player.
 */
export function addPhilosophyTokens(player: PlayerState, amount: number): PlayerState {
  return { ...player, philosophyTokens: player.philosophyTokens + amount };
}

/**
 * Subtracts philosophy tokens from a player.
 */
export function subtractPhilosophyTokens(
  player: PlayerState,
  amount: number,
): Result<PlayerState, GameError> {
  if (player.philosophyTokens < amount) {
    return {
      ok: false,
      error: {
        code: 'INSUFFICIENT_RESOURCES',
        message: `Cannot spend ${amount} philosophy tokens: only ${player.philosophyTokens} available`,
      },
    };
  }
  return { ok: true, value: { ...player, philosophyTokens: player.philosophyTokens - amount } };
}

/**
 * Adds a knowledge token to a player's collection.
 */
export function addKnowledgeToken(player: PlayerState, token: KnowledgeToken): PlayerState {
  return { ...player, knowledgeTokens: [...player.knowledgeTokens, token] };
}

/**
 * Checks whether a player meets a knowledge token requirement.
 * Tokens are verified, NOT spent.
 */
export function meetsKnowledgeRequirement(
  player: PlayerState,
  requirement: KnowledgeRequirement,
  philosophyPairsToUse: number = 0,
): boolean {
  const greenCount = player.knowledgeTokens.filter(t => t.color === 'GREEN').length;
  const blueCount = player.knowledgeTokens.filter(t => t.color === 'BLUE').length;
  const redCount = player.knowledgeTokens.filter(t => t.color === 'RED').length;

  const totalRequired = requirement.green + requirement.blue + requirement.red;
  const totalHave = Math.min(greenCount, requirement.green)
    + Math.min(blueCount, requirement.blue)
    + Math.min(redCount, requirement.red);
  const shortfall = totalRequired - totalHave;

  // Each philosophy token pair covers one missing knowledge requirement
  if (philosophyPairsToUse > 0 && player.philosophyTokens >= philosophyPairsToUse * 2) {
    return shortfall <= philosophyPairsToUse;
  }

  return greenCount >= requirement.green
    && blueCount >= requirement.blue
    && redCount >= requirement.red;
}

/**
 * Adds VP to a player's score track.
 */
export function addVP(player: PlayerState, amount: number): PlayerState {
  return { ...player, victoryPoints: player.victoryPoints + amount };
}
