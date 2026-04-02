/**
 * Core data models for Khora Online.
 */

import type { ActionType, GamePhase, KnowledgeColor } from './enums';
import type {
  AchievementCondition,
  CityDevelopment,
  GameEffect,
  GloryCondition,
  KnowledgeRequirement,
  KnowledgeToken,
  ScoringRule,
} from './effects';
import type { DisconnectionInfo, FinalScoreBoard, GameLogEntry, PendingDecision } from './types';

/** A single action slot where a player assigns a die to an action. */
export interface ActionSlot {
  actionType: ActionType;
  assignedDie: number;       // 1–6
  resolved: boolean;
  citizenCost: number;       // Citizen track levels lost to cover die deficit
}

/** Tuple of action slots: 2 base + optional 3rd from culture track level 4. */
export type ActionSlotTuple = [ActionSlot | null, ActionSlot | null, ActionSlot | null];

/** Complete state for one player. */
export interface PlayerState {
  playerId: string;
  playerName: string;
  cityId: string;

  // Coins (drachmas)
  coins: number;

  // Tracks
  economyTrack: number;       // Progress track, starts at 1
  cultureTrack: number;       // Progress track, starts at 1
  militaryTrack: number;      // Progress track, starts at 1, can temporarily exceed max
  taxTrack: number;           // Determines drachma income, starts at 0
  gloryTrack: number;         // Multiplied by major knowledge tokens for endgame, starts at 0
  troopTrack: number;         // Determines troop gain from Military action, starts at 0
  citizenTrack: number;       // Spent for die deficits, starts at 3, can temporarily exceed max

  // Tokens
  philosophyTokens: number;
  knowledgeTokens: KnowledgeToken[];

  // Cards
  handCards: PoliticsCard[];    // Cards in hand (from drafting and Legislation)
  playedCards: PoliticsCard[];  // Cards played via Politics action

  // City developments
  developmentLevel: number;     // 1–3, how many developments unlocked (1st is active at game start)

  // Round state
  diceRoll: number[] | null;    // 2 dice (3 if culture track >= 4)
  actionSlots: ActionSlotTuple;

  // Scoring
  victoryPoints: number;       // Score track position

  // Connection
  isConnected: boolean;
}

/** An event card revealed during the Omen phase. */
export interface EventCard {
  id: string;
  name: string;
  immediateEffect: GameEffect | null;
  gloryCondition: GloryCondition;
  penaltyEffect: GameEffect | null;
  /** If true, this event triggers during the Dice phase instead of Event Resolution. */
  triggerDuringDice?: boolean;
}

/** A politics card that can be played from hand. */
export interface PoliticsCard {
  id: string;
  name: string;
  description: string;                     // Human-readable card text
  cost: number;                           // Drachma cost
  knowledgeRequirement: KnowledgeRequirement;  // Tokens needed (verified, not spent)
  type: 'IMMEDIATE' | 'ONGOING' | 'END_GAME';
  effect: GameEffect;
  endGameScoring: ScoringRule | null;
}

/** An achievement token that can be claimed during the Achievement phase. */
export interface AchievementToken {
  id: string;
  name: string;
  condition: AchievementCondition;
  // Achievements don't award VP directly — they advance tax or glory track
}

/** A city card defining starting state and unique development path. */
export interface CityCard {
  id: string;
  name: string;
  startingCoins: number;
  startingTracks: {
    economy: number;
    culture: number;
    military: number;
    tax: number;
    glory: number;
    troop: number;
    citizen: number;
  };
  developments: CityDevelopment[];  // 3 development slots
}

/** State for the city-picking sub-phase. */
export interface CityDraftState {
  pickOrder: string[];                        // Randomized player order for picking
  currentPickerIndex: number;                 // Index into pickOrder
  offeredCities: Record<string, string[]>;    // playerId → offered cityId[] (3 per player)
  remainingPool: CityCard[];                  // Cities not yet picked or offered
  selections: Record<string, string>;         // playerId → chosen cityId
  allCities: CityCard[];                      // Full city list for display
}

/** State for the politics-card-drafting sub-phase. */
export interface PoliticsDraftState {
  packs: Record<string, PoliticsCard[]>;      // playerId → current pack to pick from
  draftRound: number;                         // 1–5 (pick one card per round)
  selectedCards: Record<string, PoliticsCard[]>; // playerId → cards picked so far
  waitingFor: string[];                       // Players who haven't picked this round
  passOrder: string[];                        // Player order for passing packs
}

/** Combined draft state for the pre-game picking phase. */
export interface DraftState {
  cityDraft: CityDraftState | null;
  politicsDraft: PoliticsDraftState | null;
}

/** The complete authoritative game state. */
export interface GameState {
  gameId: string;
  roundNumber: number;           // 1–9
  currentPhase: GamePhase;
  players: PlayerState[];
  eventDeck: EventCard[];        // Remaining event cards
  currentEvent: EventCard | null;
  politicsDeck: PoliticsCard[];  // Draw pile for Legislation
  centralBoardTokens: KnowledgeToken[];  // Available for exploration
  availableAchievements: AchievementToken[];
  claimedAchievements: Map<string, AchievementToken[]>; // playerId -> tokens
  startPlayerId: string;         // Current round's start player
  turnOrder: string[];           // Player order for current round
  gameLog: GameLogEntry[];
  pendingDecisions: PendingDecision[];
  disconnectedPlayers: Map<string, DisconnectionInfo>;
  draftState: DraftState | null; // Active during CITY_SELECTION and DRAFT_POLITICS
  finalScores: FinalScoreBoard | null; // Set during FINAL_SCORING, displayed in GAME_OVER
  createdAt: number;             // Unix timestamp
  updatedAt: number;
}
