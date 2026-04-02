/**
 * Effect types, conditions, and scoring rules for Khora Online.
 */

import type { KnowledgeColor, KnowledgeType, ProgressTrackType, TrackType } from './enums';
import type { PlayerState } from './models';

/** A composable game effect that can be applied to player or game state. */
export type GameEffect =
  | { type: 'GAIN_COINS'; amount: number }
  | { type: 'LOSE_COINS'; amount: number }
  | { type: 'GAIN_CITIZENS'; amount: number }
  | { type: 'LOSE_CITIZENS'; amount: number }
  | { type: 'GAIN_PHILOSOPHY_TOKENS'; amount: number }
  | { type: 'ADVANCE_TRACK'; track: TrackType; amount: number }
  | { type: 'GAIN_VP'; amount: number }
  | { type: 'COMPOSITE'; effects: GameEffect[] };

/** Knowledge token requirement for a politics card or development. */
export interface KnowledgeRequirement {
  green: number;
  blue: number;
  red: number;
}

/** A knowledge token on the central board or in a player's possession. */
export interface KnowledgeToken {
  id: string;
  color: KnowledgeColor;
  tokenType: KnowledgeType;
  /** Troop level required to explore this token. */
  militaryRequirement?: number;
  /** Troops lost when exploring this token (skull value). */
  skullValue?: number;
  /** Drachma bonus gained when exploring this token. */
  bonusCoins?: number;
  /** VP bonus gained when exploring this token. */
  bonusVP?: number;
  /** If true, this is Persepolis — grants 1 major of each color when explored. */
  isPersepolis?: boolean;
  /** If true, this token has been explored and is no longer available. */
  explored?: boolean;
}

/** Condition evaluated during the Glory phase to award VP. */
export interface GloryCondition {
  type: 'TRACK_COMPARISON' | 'RESOURCE_THRESHOLD' | 'CARD_COUNT' | 'CUSTOM';
  evaluate: (player: PlayerState, allPlayers: PlayerState[]) => boolean;
  description: string;
}

/** Condition evaluated during the Achievement phase. */
export interface AchievementCondition {
  type: 'TRACK_LEVEL' | 'RESOURCE_COUNT' | 'CARD_COMBINATION' | 'CUSTOM';
  evaluate: (player: PlayerState) => boolean;
  description: string;
}

/** Rule for calculating VP from a specific source. */
export interface ScoringRule {
  type: 'PER_CARD' | 'PER_TRACK_LEVEL' | 'PER_RESOURCE' | 'SET_COLLECTION' | 'CUSTOM';
  calculate: (player: PlayerState) => number;
  description: string;
}

/** A single development slot on a city tile. */
export interface CityDevelopment {
  id: string;
  name: string;
  level: number;               // 1, 2, 3 (which development slot)
  knowledgeRequirement: KnowledgeRequirement;
  drachmaCost: number;
  effect: GameEffect;
  effectType: 'IMMEDIATE' | 'ONGOING' | 'END_GAME';
  endGameScoring?: ScoringRule;
}

/** Culture track level at which the third die is unlocked. */
export const THIRD_DIE_CULTURE_LEVEL = 4;

/** Maximum number of developments per game. */
export const MAX_DEVELOPMENTS = 4;

/** Cost of a Minor Knowledge token via Trade. */
export const MINOR_KNOWLEDGE_COST = 5;
