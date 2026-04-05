/**
 * Client <-> Server message types and visibility-filtered state for Khora Online.
 */

import type { ActionType, DecisionType, GamePhase, KnowledgeColor, ProgressTrackType } from './enums';
import type { KnowledgeToken } from './effects';
import type { ActionSlot, ActionSlotTuple, AchievementToken, CityCard, EventCard, PoliticsCard } from './models';
import type {
  ActionChoices,
  DiceAssignment,
  FinalScoreBoard,
  GameLogEntry,
  TrackAdvancement,
} from './types';

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'SELECT_CITY'; cityId: string }
  | { type: 'DRAFT_CARD'; cardId: string }
  | { type: 'ROLL_DICE' }
  | { type: 'ASSIGN_DICE'; assignments: DiceAssignment[]; philosophyTokensToSpend?: number }
  | { type: 'UNASSIGN_DICE' }
  | { type: 'RESOLVE_ACTION'; actionType: ActionType; choices: ActionChoices }
  | { type: 'PROGRESS_TRACK'; advancement: TrackAdvancement; extraTracks?: TrackAdvancement[]; bonusTracks?: TrackAdvancement[] }
  | { type: 'UNDO_PROGRESS' }
  | { type: 'SKIP_PHASE' }
  | { type: 'CLAIM_ACHIEVEMENT'; achievementId: string; trackChoice: 'TAX' | 'GLORY' }
  | { type: 'HEARTBEAT' }
  | { type: 'ACTIVATE_DEV'; devId: string }
  | { type: 'CHOOSE_TOKEN'; tokenId: string }
  | { type: 'EVENT_PROGRESS_TRACK'; track: ProgressTrackType }
  | { type: 'DISCARD_CARDS'; cardIds: string[] }
  | { type: 'ADMIN_REQUEST_DECK' }
  | { type: 'ADMIN_SWAP_CARD'; handCardId: string; deckCardId: string }
  | { type: 'ADMIN_REQUEST_EVENTS' }
  | { type: 'ADMIN_REORDER_EVENTS'; eventOrder: string[] };

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'GAME_STATE_UPDATE'; state: PublicGameState; privateState: PrivatePlayerState }
  | { type: 'PHASE_CHANGE'; phase: GamePhase; roundNumber: number }
  | { type: 'AWAITING_DECISION'; playerId: string; decisionType: DecisionType; timeoutMs: number }
  | { type: 'GAME_LOG_ENTRY'; entry: GameLogEntry }
  | { type: 'PLAYER_DISCONNECTED'; playerId: string }
  | { type: 'PLAYER_RECONNECTED'; playerId: string }
  | { type: 'GAME_OVER'; finalScores: FinalScoreBoard }
  | { type: 'ERROR'; code: string; message: string }
  | { type: 'ADMIN_DECK_RESPONSE'; deckCards: PoliticsCard[] }
  | { type: 'ADMIN_EVENTS_RESPONSE'; eventCards: EventCard[]; unusedEvents: EventCard[] };

// ---------------------------------------------------------------------------
// Visibility-filtered state
// ---------------------------------------------------------------------------

/** State visible to all players. */
export interface PublicGameState {
  roundNumber: number;
  currentPhase: GamePhase;
  currentEvent: EventCard | null;
  centralBoardTokens: KnowledgeToken[];
  availableAchievements: AchievementToken[];
  claimedAchievements: Record<string, AchievementToken[]>; // playerId → claimed tokens
  cityCards: Record<string, CityCard>; // cityId → full city card data
  players: PublicPlayerState[];
  startPlayerId: string;
  turnOrder: string[];
  gameLog: GameLogEntry[];
  pendingDecisions: { playerId: string; decisionType: DecisionType; timeoutAt: number }[];
  // Draft phase fields (null when not in a draft phase)
  cityDraft: {
    pickOrder: string[];
    currentPickerIndex: number;
    selections: Record<string, string>;
    allCities: CityCard[];
  } | null;
  politicsDraft: {
    draftRound: number;
    waitingFor: string[];
    totalRounds: number;
  } | null;
  finalScores: FinalScoreBoard | null;
}

/** Per-player info visible to everyone. */
export interface PublicPlayerState {
  playerId: string;
  playerName: string;
  cityId: string;
  // Progress tracks
  economyTrack: number;
  cultureTrack: number;
  militaryTrack: number;
  // Other tracks
  taxTrack: number;
  gloryTrack: number;
  troopTrack: number;
  citizenTrack: number;
  // Resources
  coins: number;
  philosophyTokens: number;
  knowledgeTokens: KnowledgeToken[];
  // Public counts
  handCardCount: number;
  playedCardCount: number;
  playedCardSummaries: { name: string; type: string; description: string }[];
  knowledgeTokenCount: number;
  developmentLevel: number;
  victoryPoints: number;
  diceRoll: number[] | null;
  actionSlots: { actionType: ActionType; resolved: boolean }[];
  isConnected: boolean;
}

/** Private info sent only to the owning player. */
export interface PrivatePlayerState {
  coins: number;
  philosophyTokens: number;
  knowledgeTokens: KnowledgeToken[];
  diceRoll: number[] | null;
  actionSlots: ActionSlotTuple;
  handCards: PoliticsCard[];
  playedCards: PoliticsCard[];
  // Draft phase fields (null when not in a draft phase)
  offeredCities: CityCard[] | null;       // 3 cities offered during CITY_SELECTION (only for current picker)
  draftPack: PoliticsCard[] | null;       // Current pack of cards during DRAFT_POLITICS
  draftedCards: PoliticsCard[] | null;    // Cards already drafted during DRAFT_POLITICS
  legislationDraw: PoliticsCard[] | null; // Top 2 cards peeked for legislation action choice
}
