/**
 * City development system for Khora Online.
 *
 * Each city has 3 development slots. Players unlock them via the Development
 * action (max 3 per game). Developments require knowledge tokens (verified,
 * not spent) and drachmas.
 *
 * Development effects:
 * - IMMEDIATE: applied once when unlocked
 * - ONGOING: active for the rest of the game
 * - END_GAME: scored during final scoring
 */

import type { GameEffect, PlayerState, CityCard, CityDevelopment } from '@khora/shared';
import { MAX_DEVELOPMENTS } from '@khora/shared';
import { applyEffectToPlayer } from './effects';

/**
 * Returns the next development available for a player's city.
 * Returns null if all 3 developments have been unlocked.
 */
export function getNextDevelopment(city: CityCard, player: PlayerState): CityDevelopment | null {
  if (player.developmentLevel >= MAX_DEVELOPMENTS) return null;
  return city.developments[player.developmentLevel] ?? null;
}

/**
 * Returns all unlocked developments for a player.
 */
export function getUnlockedDevelopments(city: CityCard, player: PlayerState): CityDevelopment[] {
  return city.developments.slice(0, player.developmentLevel);
}

/**
 * Collects all ONGOING development effects that are currently active for a player.
 */
export function collectOngoingDevelopmentEffects(
  city: CityCard,
  player: PlayerState,
): GameEffect[] {
  return getUnlockedDevelopments(city, player)
    .filter(dev => dev.effectType === 'ONGOING')
    .map(dev => dev.effect);
}

/**
 * Applies a development's IMMEDIATE effect to the player.
 */
export function applyDevelopmentEffect(
  player: PlayerState,
  development: CityDevelopment,
): PlayerState {
  if (development.effectType !== 'IMMEDIATE') return player;
  return applyEffectToPlayer(player, development.effect);
}
