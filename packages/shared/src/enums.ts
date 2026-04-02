/**
 * Enums and union types for Khora Online.
 */

/** Phases of the game state machine. */
export type GamePhase =
  | 'LOBBY'
  | 'CITY_SELECTION'
  | 'DRAFT_POLITICS'
  | 'OMEN'
  | 'TAXATION'
  | 'DICE'
  | 'ACTIONS'
  | 'PROGRESS'
  | 'GLORY'
  | 'ACHIEVEMENT'
  | 'FINAL_SCORING'
  | 'GAME_OVER';

/** The seven player actions, numbered 0–6. */
export type ActionType =
  | 'PHILOSOPHY'
  | 'LEGISLATION'
  | 'CULTURE'
  | 'TRADE'
  | 'MILITARY'
  | 'POLITICS'
  | 'DEVELOPMENT';

/** Action number mapping (0–6). */
export const ACTION_NUMBERS: Record<ActionType, number> = {
  PHILOSOPHY: 0,
  LEGISLATION: 1,
  CULTURE: 2,
  TRADE: 3,
  MILITARY: 4,
  POLITICS: 5,
  DEVELOPMENT: 6,
};

/** Reverse lookup: action number to action type. */
export const ACTION_BY_NUMBER: Record<number, ActionType> = {
  0: 'PHILOSOPHY',
  1: 'LEGISLATION',
  2: 'CULTURE',
  3: 'TRADE',
  4: 'MILITARY',
  5: 'POLITICS',
  6: 'DEVELOPMENT',
};

/** Knowledge token colors. */
export type KnowledgeColor = 'GREEN' | 'BLUE' | 'RED';

/** Knowledge token types. */
export type KnowledgeType = 'MAJOR' | 'MINOR';

/** The three progress tracks advanced in the Progress phase. */
export type ProgressTrackType = 'ECONOMY' | 'CULTURE' | 'MILITARY';

/** All player board tracks. */
export type TrackType =
  | ProgressTrackType
  | 'TAX'
  | 'GLORY'
  | 'TROOP'
  | 'CITIZEN';

/** Development effect timing. */
export type DevelopmentEffectType = 'IMMEDIATE' | 'ONGOING' | 'END_GAME';

/** Types of decisions a player can be prompted for. */
export type DecisionType =
  | 'SELECT_CITY'
  | 'DRAFT_CARD'
  | 'ROLL_DICE'
  | 'ASSIGN_DICE'
  | 'SPEND_PHILOSOPHY_TOKENS'
  | 'RESOLVE_ACTION'
  | 'CHOOSE_LEGISLATION_CARD'
  | 'CHOOSE_TRADE_BUY'
  | 'CHOOSE_EXPLORATION'
  | 'CHOOSE_POLITICS_CARD'
  | 'CHOOSE_DEVELOPMENT'
  | 'PROGRESS_TRACK'
  | 'ACHIEVEMENT_TRACK_CHOICE'
  | 'PHASE_DISPLAY'
  | 'PROSPERITY_POLITICS'
  | 'ORACLE_CHOOSE_TOKEN'
  | 'MILITARY_VICTORY_PROGRESS'
  | 'RISE_OF_PERSIA_PROGRESS'
  | 'THIRTY_TYRANTS_DISCARD'
  | 'CONQUEST_ACTION';
