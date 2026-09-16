/**
 * @khora/client — Re-export shared types needed by client components.
 */

export { ACTION_NUMBERS } from '@khora/shared';

export type {
  // Enums
  GamePhase,
  ActionType,
  TrackType,
  ProgressTrackType,
  DecisionType,
  KnowledgeColor,
  DraftMode,
  // Models
  ActionSlot,
  PlayerState,
  EventCard,
  PoliticsCard,
  AchievementToken,
  CityCard,
  GameState,
  DraftState,
  CityDraftState,
  PoliticsDraftState,
  PickBanDraftState,
  // Messages
  PublicGameState,
  PublicPlayerState,
  PrivatePlayerState,
  ClientMessage,
  ServerMessage,
  // Types
  DiceAssignment,
  TrackAdvancement,
  ActionChoices,
  PendingDecision,
  GameLogEntry,
  FinalScoreBoard,
  PlayerFinalScore,
  PlayerInfo,
  GameError,
  ActionCostResult,
  // Effects
  GameEffect,
  GloryCondition,
  AchievementCondition,
  ScoringRule,
  CityDevelopment,
  KnowledgeToken,
  KnowledgeRequirement,
} from '@khora/shared';
