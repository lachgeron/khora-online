/**
 * Shared test factories for Khora Online server tests.
 *
 * Provides makeTestPlayer() and makeTestGameState() that produce
 * valid objects conforming to the current type definitions.
 */

import type {
  PlayerState,
  GameState,
  EventCard,
  PoliticsCard,
  AchievementToken,
  CityCard,
  KnowledgeToken,
  ActionSlot,
  GamePhase,
} from '@khora/shared';

/** Creates a valid PlayerState with sensible defaults. */
export function makeTestPlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    playerId: 'player-1',
    playerName: 'Alice',
    cityId: 'athens',
    isConnected: true,
    coins: 4,
    economyTrack: 1,
    cultureTrack: 1,
    militaryTrack: 1,
    taxTrack: 0,
    gloryTrack: 0,
    troopTrack: 0,
    citizenTrack: 3,
    philosophyTokens: 0,
    knowledgeTokens: [],
    victoryPoints: 0,
    handCards: [],
    playedCards: [],
    developmentLevel: 1,
    diceRoll: null,
    actionSlots: [null, null, null],
    timeBankMs: 120_000,
    ...overrides,
  };
}

/** Creates a valid GameState with two default players. */
export function makeTestGameState(overrides: Partial<GameState> = {}): GameState {
  const players = overrides.players ?? [
    makeTestPlayer({ playerId: 'player-1', playerName: 'Alice' }),
    makeTestPlayer({ playerId: 'player-2', playerName: 'Bob' }),
  ];
  return {
    gameId: 'game-1',
    roundNumber: 1,
    currentPhase: 'OMEN' as GamePhase,
    players,
    eventDeck: [],
    currentEvent: null,
    politicsDeck: [],
    centralBoardTokens: [],
    availableAchievements: [],
    claimedAchievements: new Map(),
    startPlayerId: players[0]?.playerId ?? '',
    turnOrder: players.map((p) => p.playerId),
    gameLog: [],
    pendingDecisions: [],
    disconnectedPlayers: new Map(),
    draftMode: 'STANDARD',
    draftState: null,
    finalScores: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

/** Creates a test EventCard. */
export function makeTestEventCard(id: string, overrides: Partial<EventCard> = {}): EventCard {
  return {
    id,
    name: `Event ${id}`,
    immediateEffect: null,
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'No one qualifies' },
    penaltyEffect: null,
    ...overrides,
  };
}

/** Creates a test PoliticsCard. */
export function makeTestPoliticsCard(id: string, overrides: Partial<PoliticsCard> = {}): PoliticsCard {
  return {
    id,
    name: `Politics ${id}`,
    description: 'Test card',
    cost: 2,
    knowledgeRequirement: { green: 0, blue: 0, red: 0 },
    type: 'ONGOING',
    effect: { type: 'GAIN_COINS', amount: 1 },
    endGameScoring: null,
    ...overrides,
  };
}

/** Creates a test AchievementToken. */
export function makeTestAchievement(id: string, overrides: Partial<AchievementToken> = {}): AchievementToken {
  return {
    id,
    name: `Achievement ${id}`,
    condition: { type: 'CUSTOM', evaluate: () => false, description: 'Never qualifies' },
    ...overrides,
  };
}

/** Creates a test CityCard. */
export function makeTestCityCard(id: string, overrides: Partial<CityCard> = {}): CityCard {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    startingCoins: 4,
    startingTracks: {
      economy: 1,
      culture: 1,
      military: 1,
      tax: 0,
      glory: 0,
      troop: 0,
      citizen: 3,
    },
    developments: [
      {
        id: `${id}-dev-1`,
        name: 'Development 1',
        level: 1,
        knowledgeRequirement: { green: 0, blue: 0, red: 0 },
        drachmaCost: 0,
        effect: { type: 'GAIN_COINS', amount: 1 },
        effectType: 'IMMEDIATE',
      },
    ],
    ...overrides,
  };
}

/** Creates a test KnowledgeToken. */
export function makeTestKnowledgeToken(
  overrides: Partial<KnowledgeToken> = {},
): KnowledgeToken {
  return {
    id: 'kt-1',
    color: 'GREEN',
    tokenType: 'MINOR',
    militaryRequirement: 0,
    skullValue: 0,
    ...overrides,
  };
}
