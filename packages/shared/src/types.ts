/**
 * Supporting types for Khora Online.
 */

import type { ActionType, DecisionType, GamePhase, KnowledgeColor, ProgressTrackType, TrackType } from './enums';

/** Assignment of a die to an action slot. */
export interface DiceAssignment {
  slotIndex: 0 | 1 | 2;
  actionType: ActionType;
  dieValue: number;
}

/** A request to advance a progress track by one level. */
export interface TrackAdvancement {
  track: ProgressTrackType;
}

/** Phase-specific choices made when resolving an action. */
export interface ActionChoices {
  /** Card ID to keep (Legislation: pick 1 of 2 drawn) or play (Politics: from hand). */
  targetCardId?: string;
  /** Card ID to discard (Legislation: the other of 2 drawn). */
  discardCardId?: string;
  /** Track advancements for Progress phase. */
  trackAdvancement?: TrackAdvancement;
  /** Whether to buy a Minor Knowledge token (Trade action). */
  buyMinorKnowledge?: boolean;
  /** Color of Minor Knowledge token to buy (Trade action). */
  minorKnowledgeColor?: KnowledgeColor;
  /** Knowledge token ID to explore (Military action). */
  explorationTokenId?: string;
  /** Second knowledge token ID to explore (Military action, Thebes dev-3: explore twice). */
  secondExplorationTokenId?: string;
  /** Number of philosophy tokens to spend (Dice phase). */
  philosophyTokensToSpend?: number;
  /** Track to advance when achieving (TAX or GLORY). */
  achievementTrackChoice?: 'TAX' | 'GLORY';
  /** Number of philosophy scroll pairs (2 scrolls each) to spend to cover missing knowledge requirements. */
  philosophyPairsToUse?: number;
  /** Track choices for developments that let the player pick tracks (e.g. Miletus dev 2). */
  devTrackChoices?: ProgressTrackType[];
  /** Color of minor token to gain from Scholarly Welcome. */
  scholarlyWelcomeColor?: KnowledgeColor;
  /** Card ID to return to hand via Ostracism. */
  ostracismReturnCardId?: string;
  /** Argos dev 2 reward choice: 'troops' | 'coins' | 'vp' | 'citizens'. */
  argosDevReward?: 'troops' | 'coins' | 'vp' | 'citizens';
  /** Token IDs to explore during Sparta dev-3 (Take 2 military actions). Up to 2. */
  spartaMilitaryTokenIds?: string[];
}

/** A decision the server is waiting on from a specific player. */
export interface PendingDecision {
  playerId: string;
  decisionType: DecisionType;
  timeoutAt: number;           // Unix timestamp
  options: unknown;            // Phase-specific options
}

/** Info about a disconnected player's reconnection window. */
export interface DisconnectionInfo {
  disconnectedAt: number;
  expiresAt: number;           // disconnectedAt + 300_000ms
}

/** A single entry in the game log. */
export interface GameLogEntry {
  timestamp: number;
  roundNumber: number;
  phase: GamePhase;
  playerId: string | null;     // null for system events
  action: string;              // Human-readable description
  details: Record<string, unknown>;
}

/** Result of checking whether an action can be performed. */
export interface ActionCostResult {
  canPerform: boolean;
  citizenCost: number;         // Citizen track levels needed to cover die deficit
  reason?: string;             // Explanation if canPerform is false
}

/** Final scoreboard shown at end of game. */
export interface FinalScoreBoard {
  rankings: PlayerFinalScore[];
  winnerId: string;
}

/** Per-player final score breakdown. */
export interface PlayerFinalScore {
  playerId: string;
  playerName: string;
  breakdown: {
    scoreTrackPoints: number;      // VP accumulated during the game
    developmentPoints: number;
    politicsCardPoints: number;
    gloryKnowledgePoints: number;  // gloryTrack * majorKnowledgeCount
    /** Detailed line items for each end-game VP source. */
    detailedSources: { label: string; points: number }[];
  };
  totalPoints: number;
  rank: number;
}

/** Basic player info used before full game state exists. */
export interface PlayerInfo {
  playerId: string;
  playerName: string;
}

/** A discriminated-union Result type for operations that can fail. */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Structured game error. */
export interface GameError {
  code: GameErrorCode;
  message: string;
}

/** Known error codes. */
export type GameErrorCode =
  | 'INVALID_MESSAGE'
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'DECISION_TIMEOUT'
  | 'INSUFFICIENT_RESOURCES'
  | 'INSUFFICIENT_KNOWLEDGE'
  | 'DUPLICATE_ACTION'
  | 'TRACK_MAX_REACHED'
  | 'CITY_TAKEN'
  | 'LOBBY_FULL'
  | 'INSUFFICIENT_PLAYERS'
  | 'PLAYER_NOT_FOUND'
  | 'GAME_NOT_FOUND'
  | 'INVALID_DECISION'
  | 'MAX_DEVELOPMENTS_REACHED'
  | 'CARD_NOT_IN_HAND'
  | 'ALREADY_ROLLED'
  | 'DICE_NOT_ROLLED';
