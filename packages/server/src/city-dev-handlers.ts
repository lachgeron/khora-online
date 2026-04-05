/**
 * City development effect handlers.
 * 
 * Many developments have complex effects that can't be represented
 * by the simple GameEffect system. This module provides dedicated
 * handlers for each development that needs custom logic.
 */

import type { GameState, PlayerState } from '@khora/shared';
import type { ActionChoices } from '@khora/shared';
import { explore } from './knowledge-tokens';
import { advanceTrack } from './resources';

function updatePlayer(state: GameState, playerId: string, fn: (p: PlayerState) => PlayerState): GameState {
  const idx = state.players.findIndex(p => p.playerId === playerId);
  if (idx === -1) return state;
  const players = [...state.players];
  players[idx] = fn(players[idx]);
  return { ...state, players };
}

/**
 * Custom IMMEDIATE development handlers.
 * Called when the development is unlocked via the Development action.
 */
export const DEV_IMMEDIATE_HANDLERS: Record<string, (state: GameState, playerId: string, choices?: ActionChoices) => GameState> = {
  // Corinth dev 2: Gain taxes equal to the number of tokens you have
  'corinth-dev-2': (s, pid) => updatePlayer(s, pid, p => ({
    ...p, taxTrack: p.taxTrack + p.knowledgeTokens.length,
  })),

  // Miletus dev 2: Choose 2 tracks, move up 1 each free (with milestone rewards)
  'miletus-dev-2': (s, pid, choices) => {
    const tracks = choices?.devTrackChoices;
    if (!tracks || tracks.length !== 2) {
      // Fallback: advance economy and culture
      return updatePlayer(s, pid, p => advanceTrack(advanceTrack(p, 'ECONOMY', 1), 'CULTURE', 1));
    }
    return updatePlayer(s, pid, p => {
      let updated = p;
      for (const track of tracks) {
        updated = advanceTrack(updated, track, 1);
      }
      return updated;
    });
  },

  // Sparta dev 3: Take 2 military actions — gain troops equal to military track * 2,
  // then optionally explore up to 2 knowledge tokens
  'sparta-dev-3': (s, pid, choices) => {
    // Step 1: Gain troops = militaryTrack * 2 (two military actions worth)
    let state = updatePlayer(s, pid, p => ({
      ...p, troopTrack: p.troopTrack + p.militaryTrack * 2,
    }));

    // Step 2: Optionally explore up to 2 knowledge tokens
    const tokenIds = choices?.spartaMilitaryTokenIds ?? [];
    for (const tokenId of tokenIds.slice(0, 2)) {
      if (!tokenId) continue;
      const result = explore(state, pid, tokenId);
      if (result.ok) {
        state = result.value;
      }
    }

    return state;
  },

  // Olympia dev 4: Take 3 culture actions — gain VP equal to culture track * 3
  'olympia-dev-4': (s, pid) => updatePlayer(s, pid, p => ({
    ...p, victoryPoints: p.victoryPoints + p.cultureTrack * 3,
  })),

  // Argos dev 2: Gain 2 troops, or 3 Drachma, or 4 VP, or 5 citizens
  'argos-dev-2': (s, pid, choices) => {
    const reward = choices?.argosDevReward ?? 'vp';
    return updatePlayer(s, pid, p => {
      switch (reward) {
        case 'troops': return { ...p, troopTrack: p.troopTrack + 2 };
        case 'coins': return { ...p, coins: p.coins + 3 };
        case 'vp': return { ...p, victoryPoints: p.victoryPoints + 4 };
        case 'citizens': return { ...p, citizenTrack: Math.min(p.citizenTrack + 5, 15) };
        default: return { ...p, victoryPoints: p.victoryPoints + 4 };
      }
    });
  },

  // Argos dev 4: Gain 2 glory — handled by the effect field directly
  // Miletus dev 4: Gain 15 VP — handled by the effect field directly
};

/**
 * ONGOING development effects that trigger automatically at specific moments.
 * These are checked by the relevant resolvers/phases.
 */

/** Check if a player has a specific development unlocked */
export function hasDevUnlocked(player: PlayerState, devId: string): boolean {
  // Dev IDs follow pattern: {cityId}-dev-{level}
  // e.g., 'thebes-dev-2' means level 2 of Thebes
  const match = devId.match(/^(.+)-dev-(\d+)$/);
  if (!match) return false;
  const [, cityId, levelStr] = match;
  const level = parseInt(levelStr, 10);
  return player.cityId === cityId && player.developmentLevel >= level;
}

/**
 * ONGOING effects that trigger on specific actions.
 * Called from the action phase after resolving an action.
 */
export function applyOngoingDevEffects(
  state: GameState,
  playerId: string,
  actionType: string,
): GameState {
  const player = state.players.find(p => p.playerId === playerId);
  if (!player) return state;

  // Sparta dev 2: +1 taxes on military action
  if (actionType === 'MILITARY' && hasDevUnlocked(player, 'sparta-dev-2')) {
    state = updatePlayer(state, playerId, p => ({ ...p, taxTrack: p.taxTrack + 1 }));
  }

  // Miletus dev 3: +3 VP on trade action
  if (actionType === 'TRADE' && hasDevUnlocked(player, 'miletus-dev-3')) {
    state = updatePlayer(state, playerId, p => ({ ...p, victoryPoints: p.victoryPoints + 3 }));
  }

  // Olympia dev 2: +1 troop +1 scroll on culture action
  if (actionType === 'CULTURE' && hasDevUnlocked(player, 'olympia-dev-2')) {
    state = updatePlayer(state, playerId, p => ({
      ...p, troopTrack: p.troopTrack + 1, philosophyTokens: p.philosophyTokens + 1,
    }));
  }

  // Athens dev 2: When you play a card (politics action), gain 2 Drachma + 3 VP
  if (actionType === 'POLITICS' && hasDevUnlocked(player, 'athens-dev-2')) {
    state = updatePlayer(state, playerId, p => ({
      ...p, coins: p.coins + 2, victoryPoints: p.victoryPoints + 3,
    }));
  }

  // Athens dev 3: When you play a card (politics action), gain 2 troops
  if (actionType === 'POLITICS' && hasDevUnlocked(player, 'athens-dev-3')) {
    state = updatePlayer(state, playerId, p => ({
      ...p, troopTrack: p.troopTrack + 2,
    }));
  }

  return state;
}

/**
 * Activatable development abilities.
 * These can be used by the player at any time via a button.
 * Returns the list of activatable dev IDs for a player.
 */
export function getActivatableDevs(player: PlayerState): string[] {
  const devs: string[] = [];

  // Thebes dev 2: Lose 1 Glory → gain 2 Drachma + 4 VP (can use anytime if glory > 0)
  if (hasDevUnlocked(player, 'thebes-dev-2') && player.gloryTrack > 0) {
    devs.push('thebes-dev-2');
  }

  return devs;
}

/**
 * Activate a development ability.
 */
export function activateDev(state: GameState, playerId: string, devId: string): GameState {
  const player = state.players.find(p => p.playerId === playerId);
  if (!player) return state;

  if (devId === 'thebes-dev-2' && hasDevUnlocked(player, 'thebes-dev-2') && player.gloryTrack > 0) {
    return updatePlayer(state, playerId, p => ({
      ...p,
      gloryTrack: p.gloryTrack - 1,
      coins: p.coins + 2,
      victoryPoints: p.victoryPoints + 4,
    }));
  }

  return state;
}

/**
 * End-game scoring for city developments.
 */
export function calculateDevEndGameScore(player: PlayerState): number {
  let score = 0;

  // Corinth dev 4: 2 VP per token
  if (hasDevUnlocked(player, 'corinth-dev-4')) {
    score += player.knowledgeTokens.length * 2;
  }

  // Thebes dev 4: 2 VP per minor token
  if (hasDevUnlocked(player, 'thebes-dev-4')) {
    score += player.knowledgeTokens.filter(t => t.tokenType === 'MINOR').length * 2;
  }

  // Sparta dev 4: 4 VP per blue token
  if (hasDevUnlocked(player, 'sparta-dev-4')) {
    score += player.knowledgeTokens.filter(t => t.color === 'BLUE').length * 4;
  }

  // Athens dev 4: 3 VP per card in play
  if (hasDevUnlocked(player, 'athens-dev-4')) {
    score += player.playedCards.length * 3;
  }

  return score;
}
