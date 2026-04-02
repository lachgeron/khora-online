/**
 * GameState serialization/deserialization for Khora Online.
 *
 * Handles Map fields (claimedAchievements, disconnectedPlayers) by converting
 * them to/from arrays of [key, value] pairs for JSON compatibility.
 */

import type { GameState } from '@khora/shared';

interface SerializedGameState {
  [key: string]: unknown;
  claimedAchievements: [string, unknown[]][];
  disconnectedPlayers: [string, unknown][];
}

/**
 * Serialize a GameState to a JSON string.
 * Maps are converted to arrays of [key, value] pairs.
 */
export function serializeGameState(state: GameState): string {
  const plain: SerializedGameState = {
    ...state,
    claimedAchievements: Array.from(state.claimedAchievements.entries()),
    disconnectedPlayers: Array.from(state.disconnectedPlayers.entries()),
  };
  return JSON.stringify(plain);
}

/**
 * Deserialize a JSON string back into a GameState.
 * Reconstructs Maps from arrays of [key, value] pairs.
 */
export function deserializeGameState(json: string): GameState {
  const parsed = JSON.parse(json);
  return {
    ...parsed,
    claimedAchievements: new Map(parsed.claimedAchievements),
    disconnectedPlayers: new Map(parsed.disconnectedPlayers),
  } as GameState;
}
