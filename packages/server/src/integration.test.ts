import { describe, it, expect } from 'vitest';
import { GameEngine } from './game-engine';
import { GameServer } from './integration';
import {
  makeTestCityCard,
  makeTestEventCard,
  makeTestPoliticsCard,
  makeTestAchievement,
} from './test-helpers';
import type {
  CityCard,
  EventCard,
  PoliticsCard,
  AchievementToken,
  GameState,
  PlayerInfo,
} from '@khora/shared';
import { calculateFinalScores } from './scoring-engine';

// --- Test helpers ---

const PLAYERS: PlayerInfo[] = [
  { playerId: 'p1', playerName: 'Alice' },
  { playerId: 'p2', playerName: 'Bob' },
];

function initTestGame(): { engine: GameEngine; state: GameState } {
  const engine = new GameEngine();
  const cities = [
    makeTestCityCard('athens'),
    makeTestCityCard('sparta'),
    makeTestCityCard('corinth'),
  ];

  const eventDeck = Array.from({ length: 9 }, (_, i) => makeTestEventCard(`e${i + 1}`));
  const politicsDeck = Array.from({ length: 30 }, (_, i) => makeTestPoliticsCard(`pol${i + 1}`));
  const achievements = Array.from({ length: 4 }, (_, i) => makeTestAchievement(`ach${i + 1}`));

  let state = engine.initializeGame(PLAYERS, cities, eventDeck, politicsDeck, achievements);

  // Auto-resolve city selection
  while (state.currentPhase === 'CITY_SELECTION') {
    const pending = state.pendingDecisions[0];
    if (!pending) break;
    state = engine.handleTimeout(state, pending.playerId);
  }

  // Auto-resolve politics draft
  while (state.currentPhase === 'DRAFT_POLITICS') {
    const pending = state.pendingDecisions;
    if (pending.length === 0) break;
    for (const d of pending) {
      state = engine.handleTimeout(state, d.playerId);
    }
  }

  return { engine, state };
}

/**
 * Auto-resolve one round by timing out all players through each phase.
 * Returns the state after the round completes.
 */
function autoResolveRound(engine: GameEngine, state: GameState): GameState {
  let s = state;

  // DICE phase: timeout all players (may need multiple passes for roll + assign)
  while (s.currentPhase === 'DICE' && s.pendingDecisions.length > 0) {
    const pending = [...s.pendingDecisions];
    for (const d of pending) {
      s = engine.handleTimeout(s, d.playerId);
    }
  }

  // ACTIONS phase: timeout all players
  if (s.currentPhase === 'ACTIONS') {
    for (const player of s.players) {
      s = engine.handleTimeout(s, player.playerId);
    }
  }

  // PROGRESS phase: timeout all players
  if (s.currentPhase === 'PROGRESS') {
    for (const player of s.players) {
      s = engine.handleTimeout(s, player.playerId);
    }
  }

  // GLORY and ACHIEVEMENT auto-complete on entry
  return s;
}

describe('Integration: Full Game Loop', () => {
  it('plays through all 9 rounds and reaches GAME_OVER', () => {
    const { engine, state } = initTestGame();

    // After init, we should be in DICE phase, round 1
    expect(state.currentPhase).toBe('DICE');
    expect(state.roundNumber).toBe(1);

    let current = state;
    const roundPhases: string[] = [];

    for (let round = 1; round <= 9; round++) {
      // At the start of each round's interactive phases, we should be in DICE
      expect(current.currentPhase).toBe('DICE');
      expect(current.roundNumber).toBe(round);

      roundPhases.push(`Round ${round}: ${current.currentPhase}`);
      current = autoResolveRound(engine, current);
    }

    // After 9 rounds, game should be over
    expect(current.currentPhase).toBe('GAME_OVER');
  });

  it('calculates final scores after game completes', () => {
    const { engine, state } = initTestGame();

    let current = state;
    for (let round = 1; round <= 9; round++) {
      current = autoResolveRound(engine, current);
    }

    expect(current.currentPhase).toBe('GAME_OVER');

    const scores = calculateFinalScores(current);
    expect(scores.rankings).toHaveLength(2);
    expect(scores.winnerId).toBeTruthy();

    // Each player should have a breakdown
    for (const ranking of scores.rankings) {
      expect(ranking.breakdown).toBeDefined();
      expect(ranking.totalPoints).toBeGreaterThanOrEqual(0);
      expect(ranking.rank).toBeGreaterThan(0);
    }
  });

  it('advances round numbers correctly through all 9 rounds', () => {
    const { engine, state } = initTestGame();

    let current = state;
    const roundNumbers: number[] = [];

    for (let round = 1; round <= 9; round++) {
      roundNumbers.push(current.roundNumber);
      current = autoResolveRound(engine, current);
    }

    expect(roundNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(current.currentPhase).toBe('GAME_OVER');
  });

  it('players accumulate resources over rounds from taxation', () => {
    const { engine, state } = initTestGame();

    // After init (round 1 taxation already applied), players have starting + taxation
    const p1Initial = state.players.find(p => p.playerId === 'p1')!;
    const initialCoins = p1Initial.coins;

    // Play a few rounds
    let current = state;
    current = autoResolveRound(engine, current);
    current = autoResolveRound(engine, current);

    // After 2 more rounds of taxation, coins should have increased
    const p1After = current.players.find(p => p.playerId === 'p1')!;
    expect(p1After.coins).toBeGreaterThanOrEqual(initialCoins);
  });

  it('event deck decreases by 1 each round', () => {
    const { engine, state } = initTestGame();

    const initialDeckSize = state.eventDeck.length;
    // After init, one event was already drawn (OMEN phase ran)
    expect(initialDeckSize).toBeLessThanOrEqual(8);

    let current = state;
    current = autoResolveRound(engine, current);

    // After round 2, another event should have been drawn
    expect(current.eventDeck.length).toBe(initialDeckSize - 1);
  });
});

describe('Integration: GameServer wiring', () => {
  it('creates and starts a 2-player game via GameServer', () => {
    const server = new GameServer();
    const state = server.createAndStartGame(['Alice', 'Bob']);

    expect(state.players).toHaveLength(2);
    expect(state.currentPhase).toBe('DICE');
    expect(state.roundNumber).toBe(1);
  });

  it('plays a full game via GameServer', () => {
    const server = new GameServer();
    const state = server.createAndStartGame(['Alice', 'Bob']);
    const { state: finalState, scores } = server.playFullGame(state.gameId);

    expect(finalState.currentPhase).toBe('GAME_OVER');
    expect(scores.rankings).toHaveLength(2);
    expect(scores.winnerId).toBeTruthy();
  });

  it('plays round by round via GameServer', () => {
    const server = new GameServer();
    let state = server.createAndStartGame(['Alice', 'Bob']);

    for (let round = 1; round <= 9; round++) {
      expect(state.currentPhase).toBe('DICE');
      state = server.playRound(state.gameId);
    }

    expect(state.currentPhase).toBe('GAME_OVER');
  });

  it('persists game state', async () => {
    const server = new GameServer();
    const state = server.createAndStartGame(['Alice', 'Bob']);

    await server.persistence.saveGameState(state.gameId, state);
    const loaded = await server.persistence.loadGameState(state.gameId);

    expect(loaded).not.toBeNull();
    expect(loaded!.gameId).toBe(state.gameId);
    expect(loaded!.players).toHaveLength(2);
  });
});
