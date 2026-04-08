/**
 * Custom fast-check arbitraries for Khora Online property-based testing.
 *
 * These generators produce valid instances of all shared types,
 * respecting game constraints (track levels, dice 1–6, etc.).
 */

import * as fc from 'fast-check';
import type {
  ActionType,
  GamePhase,
  KnowledgeColor,
  KnowledgeType,
  ProgressTrackType,
  TrackType,
} from './enums';
import type {
  GameEffect,
  GloryCondition,
  AchievementCondition,
  ScoringRule,
  KnowledgeToken,
  KnowledgeRequirement,
  CityDevelopment,
} from './effects';
import type { DiceAssignment } from './types';
import type {
  ActionSlot,
  ActionSlotTuple,
  PlayerState,
  EventCard,
  PoliticsCard,
  AchievementToken,
  CityCard,
  GameState,
  DraftState,
} from './models';
import type { GameLogEntry, PendingDecision, DisconnectionInfo, FinalScoreBoard } from './types';

// ---------------------------------------------------------------------------
// Primitive arbitraries
// ---------------------------------------------------------------------------

/** Progress track level: integer in [0, 15]. */
export const arbTrackLevel: fc.Arbitrary<number> = fc.integer({ min: 0, max: 15 });

/** Small track level (tax/glory/troop): integer in [0, 10]. */
export const arbSmallTrackLevel: fc.Arbitrary<number> = fc.integer({ min: 0, max: 10 });

/** Resource amount: non-negative integer in [0, 50]. */
export const arbResourceAmount: fc.Arbitrary<number> = fc.integer({ min: 0, max: 50 });

/** Die value: integer in [1, 6]. */
export const arbDiceValue: fc.Arbitrary<number> = fc.integer({ min: 1, max: 6 });

// ---------------------------------------------------------------------------
// Enum arbitraries
// ---------------------------------------------------------------------------

const ACTION_TYPES: ActionType[] = [
  'PHILOSOPHY', 'LEGISLATION', 'CULTURE', 'TRADE',
  'MILITARY', 'POLITICS', 'DEVELOPMENT',
];

const GAME_PHASES: GamePhase[] = [
  'LOBBY', 'CITY_SELECTION', 'DRAFT_POLITICS', 'OMEN', 'TAXATION', 'DICE',
  'ACTIONS', 'PROGRESS', 'GLORY', 'ACHIEVEMENT',
  'FINAL_SCORING', 'GAME_OVER',
];

const KNOWLEDGE_COLORS: KnowledgeColor[] = ['GREEN', 'BLUE', 'RED'];
const KNOWLEDGE_TYPES: KnowledgeType[] = ['MAJOR', 'MINOR'];
const PROGRESS_TRACK_TYPES: ProgressTrackType[] = ['ECONOMY', 'CULTURE', 'MILITARY'];

export const arbActionType: fc.Arbitrary<ActionType> = fc.constantFrom(...ACTION_TYPES);
export const arbGamePhase: fc.Arbitrary<GamePhase> = fc.constantFrom(...GAME_PHASES);
export const arbKnowledgeColor: fc.Arbitrary<KnowledgeColor> = fc.constantFrom(...KNOWLEDGE_COLORS);
export const arbKnowledgeType: fc.Arbitrary<KnowledgeType> = fc.constantFrom(...KNOWLEDGE_TYPES);
export const arbProgressTrackType: fc.Arbitrary<ProgressTrackType> = fc.constantFrom(...PROGRESS_TRACK_TYPES);

// ---------------------------------------------------------------------------
// Effect & condition arbitraries
// ---------------------------------------------------------------------------

export const arbGameEffect: fc.Arbitrary<GameEffect> = fc.oneof(
  fc.record({
    type: fc.constant('GAIN_COINS' as const),
    amount: arbResourceAmount,
  }),
  fc.record({
    type: fc.constant('LOSE_COINS' as const),
    amount: arbResourceAmount,
  }),
  fc.record({
    type: fc.constant('GAIN_CITIZENS' as const),
    amount: fc.integer({ min: 1, max: 5 }),
  }),
  fc.record({
    type: fc.constant('LOSE_CITIZENS' as const),
    amount: fc.integer({ min: 1, max: 5 }),
  }),
  fc.record({
    type: fc.constant('GAIN_PHILOSOPHY_TOKENS' as const),
    amount: fc.integer({ min: 1, max: 3 }),
  }),
  fc.record({
    type: fc.constant('ADVANCE_TRACK' as const),
    track: fc.constantFrom<TrackType>('ECONOMY', 'CULTURE', 'MILITARY', 'TAX', 'GLORY', 'TROOP', 'CITIZEN'),
    amount: fc.integer({ min: 1, max: 3 }),
  }),
  fc.record({
    type: fc.constant('GAIN_VP' as const),
    amount: fc.integer({ min: 1, max: 10 }),
  }),
);

export const arbKnowledgeRequirement: fc.Arbitrary<KnowledgeRequirement> = fc.record({
  green: fc.integer({ min: 0, max: 3 }),
  blue: fc.integer({ min: 0, max: 3 }),
  red: fc.integer({ min: 0, max: 3 }),
});

export const arbKnowledgeToken: fc.Arbitrary<KnowledgeToken> = fc.record({
  id: fc.uuid(),
  color: arbKnowledgeColor,
  tokenType: arbKnowledgeType,
  militaryRequirement: fc.option(fc.integer({ min: 1, max: 10 }), { nil: undefined }),
  skullValue: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
});

const GLORY_CONDITION_TYPES: GloryCondition['type'][] = [
  'TRACK_COMPARISON', 'RESOURCE_THRESHOLD', 'CARD_COUNT', 'CUSTOM',
];

export const arbGloryCondition: fc.Arbitrary<GloryCondition> = fc.record({
  type: fc.constantFrom(...GLORY_CONDITION_TYPES),
  evaluate: fc.constant((_player: PlayerState, _allPlayers: PlayerState[]) => true),
  description: fc.string({ minLength: 1, maxLength: 60 }),
});

const ACHIEVEMENT_CONDITION_TYPES: AchievementCondition['type'][] = [
  'TRACK_LEVEL', 'RESOURCE_COUNT', 'CARD_COMBINATION', 'CUSTOM',
];

export const arbAchievementCondition: fc.Arbitrary<AchievementCondition> = fc.record({
  type: fc.constantFrom(...ACHIEVEMENT_CONDITION_TYPES),
  evaluate: fc.constant((_player: PlayerState) => true),
  description: fc.string({ minLength: 1, maxLength: 60 }),
});

const SCORING_RULE_TYPES: ScoringRule['type'][] = [
  'PER_CARD', 'PER_TRACK_LEVEL', 'PER_RESOURCE', 'SET_COLLECTION', 'CUSTOM',
];

export const arbScoringRule: fc.Arbitrary<ScoringRule> = fc.record({
  type: fc.constantFrom(...SCORING_RULE_TYPES),
  calculate: fc.constant((_player: PlayerState) => 0),
  description: fc.string({ minLength: 1, maxLength: 60 }),
});

// ---------------------------------------------------------------------------
// City development arbitrary
// ---------------------------------------------------------------------------

export const arbCityDevelopment: fc.Arbitrary<CityDevelopment> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  level: fc.integer({ min: 1, max: 3 }),
  knowledgeRequirement: arbKnowledgeRequirement,
  drachmaCost: fc.integer({ min: 0, max: 10 }),
  effect: arbGameEffect,
  effectType: fc.constantFrom('IMMEDIATE' as const, 'ONGOING' as const, 'END_GAME' as const),
  endGameScoring: fc.option(arbScoringRule, { nil: undefined }),
});

// ---------------------------------------------------------------------------
// Card & token arbitraries
// ---------------------------------------------------------------------------

export const arbCityCard: fc.Arbitrary<CityCard> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 30 }),
  startingCoins: fc.integer({ min: 0, max: 10 }),
  startingTracks: fc.record({
    economy: fc.integer({ min: 0, max: 3 }),
    culture: fc.integer({ min: 0, max: 3 }),
    military: fc.integer({ min: 0, max: 3 }),
    tax: fc.constant(0),
    glory: fc.constant(0),
    troop: fc.constant(0),
    citizen: fc.integer({ min: 2, max: 4 }),
  }),
  developments: fc.array(arbCityDevelopment, { minLength: 3, maxLength: 3 }),
});

export const arbEventCard: fc.Arbitrary<EventCard> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  immediateEffect: fc.option(arbGameEffect, { nil: null }),
  gloryCondition: arbGloryCondition,
  penaltyEffect: fc.option(arbGameEffect, { nil: null }),
  triggerDuringDice: fc.option(fc.constant(true), { nil: undefined }),
});

const POLITICS_CARD_TYPES: PoliticsCard['type'][] = ['IMMEDIATE', 'ONGOING', 'END_GAME'];

export const arbPoliticsCard: fc.Arbitrary<PoliticsCard> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  description: fc.string({ minLength: 0, maxLength: 100 }),
  cost: fc.integer({ min: 0, max: 10 }),
  knowledgeRequirement: arbKnowledgeRequirement,
  type: fc.constantFrom(...POLITICS_CARD_TYPES),
  effect: arbGameEffect,
  endGameScoring: fc.option(arbScoringRule, { nil: null }),
});

export const arbAchievementToken: fc.Arbitrary<AchievementToken> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 40 }),
  condition: arbAchievementCondition,
});

// ---------------------------------------------------------------------------
// Action slot & dice assignment arbitraries
// ---------------------------------------------------------------------------

export const arbActionSlot: fc.Arbitrary<ActionSlot> = fc.record({
  actionType: arbActionType,
  assignedDie: arbDiceValue,
  resolved: fc.boolean(),
  citizenCost: fc.integer({ min: 0, max: 6 }),
});

export const arbDiceAssignment: fc.Arbitrary<DiceAssignment> = fc.record({
  slotIndex: fc.constantFrom(0 as const, 1 as const, 2 as const),
  actionType: arbActionType,
  dieValue: arbDiceValue,
});

// ---------------------------------------------------------------------------
// Player state arbitrary
// ---------------------------------------------------------------------------

export const arbPlayerState: fc.Arbitrary<PlayerState> = fc.record({
  playerId: fc.uuid(),
  playerName: fc.string({ minLength: 1, maxLength: 20 }),
  cityId: fc.uuid(),
  coins: arbResourceAmount,
  economyTrack: arbTrackLevel,
  cultureTrack: arbTrackLevel,
  militaryTrack: arbTrackLevel,
  taxTrack: arbSmallTrackLevel,
  gloryTrack: arbSmallTrackLevel,
  troopTrack: arbSmallTrackLevel,
  citizenTrack: fc.integer({ min: 0, max: 20 }),
  philosophyTokens: fc.integer({ min: 0, max: 10 }),
  knowledgeTokens: fc.array(arbKnowledgeToken, { minLength: 0, maxLength: 6 }),
  handCards: fc.array(arbPoliticsCard, { minLength: 0, maxLength: 10 }),
  playedCards: fc.array(arbPoliticsCard, { minLength: 0, maxLength: 10 }),
  developmentLevel: fc.integer({ min: 0, max: 3 }),
  diceRoll: fc.option(
    fc.oneof(
      fc.tuple(arbDiceValue, arbDiceValue) as fc.Arbitrary<number[]>,
      fc.tuple(arbDiceValue, arbDiceValue, arbDiceValue) as fc.Arbitrary<number[]>,
    ),
    { nil: null },
  ),
  actionSlots: fc.tuple(
    fc.option(arbActionSlot, { nil: null }),
    fc.option(arbActionSlot, { nil: null }),
    fc.option(arbActionSlot, { nil: null }),
  ) as fc.Arbitrary<ActionSlotTuple>,
  victoryPoints: fc.integer({ min: 0, max: 200 }),
  isConnected: fc.boolean(),
  timeBankMs: fc.integer({ min: 0, max: 120_000 }),
});

// ---------------------------------------------------------------------------
// Game state arbitrary
// ---------------------------------------------------------------------------

export const arbGameState: fc.Arbitrary<GameState> = fc
  .integer({ min: 1, max: 4 })
  .chain((playerCount) =>
    fc.record({
      gameId: fc.uuid(),
      roundNumber: fc.integer({ min: 1, max: 9 }),
      currentPhase: arbGamePhase,
      players: fc.array(arbPlayerState, {
        minLength: playerCount,
        maxLength: playerCount,
      }),
      eventDeck: fc.array(arbEventCard, { minLength: 0, maxLength: 9 }),
      currentEvent: fc.option(arbEventCard, { nil: null }),
      politicsDeck: fc.array(arbPoliticsCard, { minLength: 0, maxLength: 30 }),
      centralBoardTokens: fc.array(arbKnowledgeToken, { minLength: 0, maxLength: 36 }),
      availableAchievements: fc.array(arbAchievementToken, {
        minLength: 0,
        maxLength: 6,
      }),
      claimedAchievements: fc.array(
        fc.tuple(fc.uuid(), fc.array(arbAchievementToken, { minLength: 0, maxLength: 3 })),
      ).map((entries) => new Map(entries)),
      startPlayerId: fc.uuid(),
      turnOrder: fc.array(fc.uuid(), { minLength: playerCount, maxLength: playerCount }),
      gameLog: fc.constant([] as GameLogEntry[]),
      pendingDecisions: fc.constant([] as PendingDecision[]),
      disconnectedPlayers: fc.constant(new Map() as Map<string, DisconnectionInfo>),
      draftState: fc.constant(null as DraftState | null),
      finalScores: fc.constant(null as FinalScoreBoard | null),
      createdAt: fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 }),
      updatedAt: fc.integer({ min: 1_700_000_000_000, max: 1_800_000_000_000 }),
    }),
  );
