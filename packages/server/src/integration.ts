/**
 * GameServer — integration wiring for Khora Online.
 *
 * Connects all components end-to-end.
 */

import type {
  CityCard,
  EventCard,
  PoliticsCard,
  AchievementToken,
  GameState,
  PlayerInfo,
} from '@khora/shared';
import type { KnowledgeToken } from '@khora/shared';

import { LobbyManager } from './lobby';
import { RestApiHandler } from './api/rest-api';
import { WebSocketGateway } from './api/websocket-gateway';
import { GameEngine } from './game-engine';
import { buildEventDeck, buildPoliticsDeck, getAllCityCards, ALL_CITIES } from './game-data';
import { TimerService } from './timer-service';
import { InMemoryPersistenceLayer } from './persistence';
import { calculateFinalScores } from './scoring-engine';

export class GameServer {
  readonly restApi: RestApiHandler;
  readonly wsGateway: WebSocketGateway;
  readonly engine: GameEngine;
  readonly timerService: TimerService;
  readonly persistence: InMemoryPersistenceLayer;

  private games = new Map<string, GameState>();

  constructor() {
    const lobbyManager = new LobbyManager();
    this.restApi = new RestApiHandler(lobbyManager);
    this.wsGateway = new WebSocketGateway();
    this.engine = new GameEngine();
    this.timerService = new TimerService();
    this.persistence = new InMemoryPersistenceLayer();
  }

  createAndStartGame(
    playerNames: string[],
    options?: {
      cityCards?: CityCard[];
      eventCards?: EventCard[];
      politicsDeck?: PoliticsCard[];
      achievements?: AchievementToken[];
      centralBoardTokens?: KnowledgeToken[];
    },
  ): GameState {
    const lobby = this.restApi.createLobby(playerNames[0]);
    if (!lobby.ok) throw new Error(`Failed to create lobby: ${lobby.error.message}`);

    const lobbyManager = this.restApi.getLobbyManager();
    const lobbyData = lobbyManager.getLobby(lobby.value.lobbyId)!;
    const playerIds: string[] = [lobby.value.hostPlayerId];

    for (let i = 1; i < playerNames.length; i++) {
      const join = this.restApi.joinLobby(lobbyData.lobbyId, playerNames[i]);
      if (!join.ok) throw new Error(`Failed to join lobby: ${join.error.message}`);
      playerIds.push(join.value.playerId);
    }

    const start = this.restApi.startGame(lobby.value.lobbyId, lobby.value.hostPlayerId);
    if (!start.ok) throw new Error(`Failed to start game: ${start.error.message}`);

    const players: PlayerInfo[] = start.value.players;

    const cities = options?.cityCards ?? makeDefaultCityCards(players.length + 2);

    const state = this.engine.initializeGame(
      players,
      cities,
      options?.eventCards ?? makeDefaultEventDeck(),
      options?.politicsDeck ?? makeDefaultPoliticsDeck(),
      options?.achievements ?? makeDefaultAchievements(),
      options?.centralBoardTokens ?? [],
    );

    // Auto-resolve draft phases so the game starts at the main loop
    let current = state;

    // City selection: auto-resolve each picker
    while (current.currentPhase === 'CITY_SELECTION') {
      const pending = current.pendingDecisions[0];
      if (!pending) break;
      current = this.engine.handleTimeout(current, pending.playerId);
    }

    // Politics draft: auto-resolve each round
    while (current.currentPhase === 'DRAFT_POLITICS') {
      const pending = current.pendingDecisions;
      if (pending.length === 0) break;
      for (const d of pending) {
        current = this.engine.handleTimeout(current, d.playerId);
      }
    }

    this.games.set(current.gameId, current);
    return current;
  }

  playRound(gameId: string): GameState {
    let state = this.games.get(gameId);
    if (!state) throw new Error(`Game ${gameId} not found`);

    // DICE phase: may need multiple passes for roll + assign sub-steps
    while (state.currentPhase === 'DICE' && state.pendingDecisions.length > 0) {
      const pending = [...state.pendingDecisions];
      for (const d of pending) {
        state = this.engine.handleTimeout(state, d.playerId);
      }
    }

    if (state.currentPhase === 'ACTIONS') {
      for (const player of state.players) {
        state = this.engine.handleTimeout(state, player.playerId);
      }
    }

    if (state.currentPhase === 'PROGRESS') {
      for (const player of state.players) {
        state = this.engine.handleTimeout(state, player.playerId);
      }
    }

    this.games.set(gameId, state);
    return state;
  }

  playFullGame(gameId: string): { state: GameState; scores: ReturnType<typeof calculateFinalScores> } {
    let state = this.games.get(gameId);
    if (!state) throw new Error(`Game ${gameId} not found`);

    while (state.currentPhase !== 'GAME_OVER') {
      state = this.playRound(state.gameId);
      this.games.set(state.gameId, state);
    }

    const scores = calculateFinalScores(state);
    return { state, scores };
  }

  getGame(gameId: string): GameState | undefined {
    return this.games.get(gameId);
  }
}

// --- Default game data factories ---
// Based on the official Khora: Rise of an Empire board game.

/**
 * The 7 city-states of Khora with distinct starting values and developments.
 * Each city has different strengths reflected in starting coins, track levels,
 * and unique development effects.
 */
export function makeDefaultCityCards(count: number): CityCard[] {
  return getAllCityCards().slice(0, count);
}

export function makeDefaultEventDeck(): EventCard[] {
  return buildEventDeck();
}

export function makeDefaultPoliticsDeck(): PoliticsCard[] {
  return buildPoliticsDeck();
}

export function makeDefaultAchievements(): AchievementToken[] {
  return [
    {
      id: 'ach-10vp',
      name: '10 Victory Points',
      condition: {
        type: 'CUSTOM' as const,
        evaluate: (player: { victoryPoints: number }) => player.victoryPoints >= 10,
        description: 'Have at least 10 VP',
      },
    },
    {
      id: 'ach-12citizens',
      name: '12 Citizens',
      condition: {
        type: 'CUSTOM' as const,
        evaluate: (player: { citizenTrack: number }) => player.citizenTrack >= 12,
        description: 'Have at least 12 citizens',
      },
    },
    {
      id: 'ach-4economy',
      name: '4 Economy',
      condition: {
        type: 'CUSTOM' as const,
        evaluate: (player: { economyTrack: number }) => player.economyTrack >= 4,
        description: 'Economy track at 4 or higher',
      },
    },
    {
      id: 'ach-3cards',
      name: '3 Politics Cards Played',
      condition: {
        type: 'CUSTOM' as const,
        evaluate: (player: { playedCards: unknown[] }) => player.playedCards.length >= 3,
        description: 'Have at least 3 politics cards in play',
      },
    },
    {
      id: 'ach-6troops',
      name: '6 Troops',
      condition: {
        type: 'CUSTOM' as const,
        evaluate: (player: { troopTrack: number }) => player.troopTrack >= 6,
        description: 'Have at least 6 troops',
      },
    },
  ];
}

/**
 * Creates the central board knowledge tokens available for exploration.
 */
export function makeDefaultCentralBoardTokens(): KnowledgeToken[] {
  // Each token: [troopReq, skullCost, color, tokenType, bonusCoins, bonusVP]
  const tokens: KnowledgeToken[] = [];

  type TokenDef = [number, number, 'RED' | 'BLUE' | 'GREEN', 'MAJOR' | 'MINOR', number, number];

  const defs: TokenDef[] = [
    // Red: bonus is drachma only. Amounts in order: 0,0,1,1,2,2,2,2,3,4,6
    [2, 1, 'RED', 'MINOR', 0, 0],
    [3, 0, 'RED', 'MINOR', 0, 0],
    [2, 2, 'RED', 'MINOR', 1, 0],
    [3, 1, 'RED', 'MINOR', 1, 0],
    [4, 2, 'RED', 'MINOR', 2, 0],
    [5, 1, 'RED', 'MAJOR', 2, 0],
    [5, 4, 'RED', 'MAJOR', 2, 0],
    [6, 3, 'RED', 'MAJOR', 2, 0],
    [7, 5, 'RED', 'MAJOR', 3, 0],
    [8, 6, 'RED', 'MAJOR', 4, 0],
    [9, 8, 'RED', 'MAJOR', 6, 0],
    // Blue: bonus is drachma + VP. Amounts: (0,0),(0,0),(1,1),(1,1),(1,1),(1,1),(2,1),(1,2),(2,2),(3,3),(4,4)
    [2, 2, 'BLUE', 'MINOR', 0, 0],
    [3, 1, 'BLUE', 'MINOR', 0, 0],
    [3, 3, 'BLUE', 'MINOR', 1, 1],
    [4, 2, 'BLUE', 'MINOR', 1, 1],
    [4, 4, 'BLUE', 'MINOR', 1, 1],
    [5, 3, 'BLUE', 'MAJOR', 1, 1],
    [6, 5, 'BLUE', 'MAJOR', 2, 1],
    [6, 5, 'BLUE', 'MAJOR', 1, 2],
    [7, 6, 'BLUE', 'MAJOR', 2, 2],
    [8, 7, 'BLUE', 'MAJOR', 3, 3],
    [9, 9, 'BLUE', 'MAJOR', 4, 4],
    // Green: bonus is VP only. Amounts in order: 0,0,1,1,2,2,2,2,3,4,6
    [2, 1, 'GREEN', 'MINOR', 0, 0],
    [3, 0, 'GREEN', 'MINOR', 0, 0],
    [2, 2, 'GREEN', 'MINOR', 0, 1],
    [3, 1, 'GREEN', 'MINOR', 0, 1],
    [4, 2, 'GREEN', 'MINOR', 0, 2],
    [5, 1, 'GREEN', 'MAJOR', 0, 2],
    [5, 4, 'GREEN', 'MAJOR', 0, 2],
    [6, 3, 'GREEN', 'MAJOR', 0, 2],
    [7, 5, 'GREEN', 'MAJOR', 0, 3],
    [8, 6, 'GREEN', 'MAJOR', 0, 4],
    [9, 8, 'GREEN', 'MAJOR', 0, 6],
  ];

  defs.forEach(([troopReq, skullCost, color, tokenType, bonusCoins, bonusVP], i) => {
    tokens.push({
      id: `board-${tokenType.toLowerCase()}-${color.toLowerCase()}-${troopReq}-${i}`,
      color,
      tokenType,
      militaryRequirement: troopReq,
      skullValue: skullCost,
      bonusCoins,
      bonusVP,
    });
  });

  // Persepolis — special token at the bottom of the board
  tokens.push({
    id: 'persepolis',
    color: 'RED' as const, // Display color (it grants all 3)
    tokenType: 'MAJOR',
    militaryRequirement: 15,
    skullValue: 15,
    bonusCoins: 0,
    bonusVP: 0,
    isPersepolis: true,
  });

  return tokens;
}
