/**
 * Client <-> Server message types and visibility-filtered state for Khora Online.
 */

import type { ActionType, DecisionType, DraftMode, GamePhase, KnowledgeColor, ProgressTrackType } from './enums';
import type { KnowledgeToken } from './effects';
import type { ActionSlot, ActionSlotTuple, AchievementToken, CityCard, EventCard, PickBanDraftState, PoliticsCard, PredeterminedDiceSchedule } from './models';
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
  | { type: 'PICK_BAN_CARD'; cardId: string; action: 'BAN' | 'PICK' }
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
  | { type: 'ADMIN_REORDER_EVENTS'; eventOrder: string[] }
  | { type: 'LIVE_SOLVER_REQUEST'; requestId: string; options?: LiveSolverRequestOptions };

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
  | { type: 'ADMIN_EVENTS_RESPONSE'; eventCards: EventCard[]; unusedEvents: EventCard[] }
  | { type: 'LIVE_SOLVER_RESULT'; result: LiveSolverResult };

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
  pendingDecisions: { playerId: string; decisionType: DecisionType; timeoutAt: number; usingTimeBank?: boolean }[];
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
    passOrder: string[];
  } | null;
  pickBanDraft: {
    allCards: PoliticsCard[];
    bannedCards: Record<string, PoliticsCard[]>;
    pickedCards: Record<string, PoliticsCard[]>;
    turnOrder: string[];
    currentTurnIndex: number;
    phase: 'BAN' | 'PICK';
    bansPerPlayer: number;
    picksPerPlayer: number;
  } | null;
  draftMode: DraftMode;
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
  hasFlagged: boolean;
  timeBankMs: number;
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
  liveSolverSnapshot: LiveSolverSnapshot | null; // Full debug snapshot used by the local live solver.
}

export interface LiveSolverPlayerSnapshot {
  playerId: string;
  playerName: string;
  cityId: string;
  coins: number;
  economyTrack: number;
  cultureTrack: number;
  militaryTrack: number;
  taxTrack: number;
  gloryTrack: number;
  troopTrack: number;
  citizenTrack: number;
  philosophyTokens: number;
  knowledgeTokens: KnowledgeToken[];
  handCardIds: string[];
  playedCardIds: string[];
  developmentLevel: number;
  diceRoll: number[] | null;
  diceRollHistory: number[];
  actionSlots: ActionSlotTuple;
  victoryPoints: number;
  isConnected: boolean;
  hasFlagged: boolean;
  timeBankMs: number;
}

export interface LiveSolverSnapshot {
  gameId: string;
  roundNumber: number;
  currentPhase: GamePhase;
  players: LiveSolverPlayerSnapshot[];
  predeterminedDice: PredeterminedDiceSchedule;
  eventDeckIds: string[];
  currentEventId: string | null;
  politicsDeckIds: string[];
  centralBoardTokens: KnowledgeToken[];
  availableAchievementIds: string[];
  claimedAchievementIds: Record<string, string[]>;
  startPlayerId: string;
  turnOrder: string[];
  gameLog: GameLogEntry[];
  pendingDecisions: { playerId: string; decisionType: DecisionType; timeoutAt: number; options: unknown; usingTimeBank?: boolean }[];
  disconnectedPlayerIds: string[];
  draftMode: DraftMode;
  finalScores: FinalScoreBoard | null;
  createdAt: number;
  updatedAt: number;
}

export interface LiveSolverRequestOptions {
  timeBudgetMs?: number;
  beamWidth?: number;
  targetBranches?: number;
  opponentBranches?: number;
  completionWidth?: number;
  maxDecisionPlies?: number;
  exactTimeBudgetMs?: number;
  exactNodeLimit?: number;
  progressIntervalMs?: number;
  skipExactSearch?: boolean;
}

export interface LiveSolverScoreProjection {
  playerId: string;
  playerName: string;
  projectedTotal: number;
  rank: number;
}

export interface LiveSolverMove {
  round: number;
  phase: GamePhase;
  playerId: string;
  playerName: string;
  decisionType: DecisionType | 'ACTIVATE_DEV';
  instruction: string;
  detail: string;
  message: ClientMessage | null;
  estimatedSeconds: number;
}

export interface LiveSolverRoundPlan {
  round: number;
  moves: LiveSolverMove[];
}

export interface LiveSolverResult {
  requestId: string;
  playerId: string;
  generatedAt: number;
  status: 'READY' | 'UNAVAILABLE' | 'ERROR';
  message: string;
  currentMove: LiveSolverMove | null;
  rounds: LiveSolverRoundPlan[];
  projections: LiveSolverScoreProjection[];
  projectedMargin: number | null;
  searchedNodes: number;
  completedLines: number;
  computeMs: number;
  horizon: 'FULL_GAME' | 'PARTIAL';
  proofStatus: 'PROVEN_OPTIMAL' | 'UNPROVEN';
  proofNodes: number;
  proofReason: string;
  opponentModel: 'MAXIMIZE_MARGIN_AGAINST_ADVERSARIAL_FIELD' | 'LIGHTWEIGHT_ACHIEVEMENT_EVENT_FIELD';
}
