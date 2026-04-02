/**
 * Effect applicator for Khora Online.
 *
 * Applies GameEffect values to PlayerState or GameState.
 * All functions are pure — they return new objects.
 */

import type { GameEffect, GameState, PlayerState } from '@khora/shared';
import { getTrackLevel, trackField } from './resources';

/**
 * Applies a single GameEffect to a PlayerState. Returns a new PlayerState.
 *
 * - GAIN_COINS: adds coins
 * - LOSE_COINS: subtracts coins, floored at 0
 * - GAIN_CITIZENS: adds citizen track levels
 * - LOSE_CITIZENS: subtracts citizen track levels, floored at 0
 * - GAIN_PHILOSOPHY_TOKENS: adds philosophy tokens
 * - ADVANCE_TRACK: advances any track by the given amount
 * - GAIN_VP: adds VP to score track
 * - COMPOSITE: applies each sub-effect in order
 */
export function applyEffectToPlayer(player: PlayerState, effect: GameEffect): PlayerState {
  switch (effect.type) {
    case 'GAIN_COINS':
      return { ...player, coins: player.coins + effect.amount };

    case 'LOSE_COINS':
      return { ...player, coins: Math.max(0, player.coins - effect.amount) };

    case 'GAIN_CITIZENS':
      return { ...player, citizenTrack: Math.min(player.citizenTrack + effect.amount, 15) };

    case 'LOSE_CITIZENS':
      return { ...player, citizenTrack: Math.max(0, player.citizenTrack - effect.amount) };

    case 'GAIN_PHILOSOPHY_TOKENS':
      return { ...player, philosophyTokens: player.philosophyTokens + effect.amount };

    case 'ADVANCE_TRACK': {
      const field = trackField(effect.track);
      const current = player[field] as number;
      return { ...player, [field]: current + effect.amount };
    }

    case 'GAIN_VP':
      return { ...player, victoryPoints: player.victoryPoints + effect.amount };

    case 'COMPOSITE':
      return effect.effects.reduce(
        (p, subEffect) => applyEffectToPlayer(p, subEffect),
        player,
      );
  }
}

/**
 * Applies a GameEffect to every player in the GameState.
 * Returns a new GameState with updated players.
 */
export function applyEffectToAllPlayers(state: GameState, effect: GameEffect): GameState {
  return {
    ...state,
    players: state.players.map((p) => applyEffectToPlayer(p, effect)),
  };
}
