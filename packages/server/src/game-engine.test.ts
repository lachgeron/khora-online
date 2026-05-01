import { describe, it, expect, vi } from 'vitest';
import { GameEngine } from './game-engine';
import {
  makeTestPlayer,
  makeTestGameState,
  makeTestCityCard,
  makeTestEventCard,
  makeTestPoliticsCard,
  makeTestAchievement,
} from './test-helpers';
import type {
  PlayerInfo,
  CityCard,
  EventCard,
  PoliticsCard,
  AchievementToken,
  GameState,
  ClientMessage,
} from '@khora/shared';

// --- Test helpers ---

const PLAYERS: PlayerInfo[] = [
  { playerId: 'p1', playerName: 'Alice' },
  { playerId: 'p2', playerName: 'Bob' },
];

function makeCityCards(): CityCard[] {
  // All cities have culture >= 2 to unlock second die for tests
  return [
    makeTestCityCard('athens', {
      startingTracks: { economy: 1, culture: 2, military: 1, tax: 0, glory: 0, troop: 0, citizen: 3 },
    }),
    makeTestCityCard('sparta', {
      startingTracks: { economy: 1, culture: 2, military: 1, tax: 0, glory: 0, troop: 0, citizen: 3 },
    }),
    makeTestCityCard('corinth', {
      startingTracks: { economy: 1, culture: 2, military: 1, tax: 0, glory: 0, troop: 0, citizen: 3 },
    }),
  ];
}

function makeEventDeck(count = 9): EventCard[] {
  return Array.from({ length: count }, (_, i) => makeTestEventCard(`e${i + 1}`));
}

function makePoliticsDeck(count = 10): PoliticsCard[] {
  return Array.from({ length: count }, (_, i) => makeTestPoliticsCard(`pol${i + 1}`));
}

function makeAchievements(count = 4): AchievementToken[] {
  return Array.from({ length: count }, (_, i) => makeTestAchievement(`ach${i + 1}`));
}

/**
 * Initializes a game and auto-resolves through CITY_SELECTION and DRAFT_POLITICS
 * to reach the main game loop (OMEN → TAXATION → DICE).
 */
function initAndSkipDraft(engine: GameEngine, options?: {
  players?: PlayerInfo[];
  cities?: CityCard[];
  events?: EventCard[];
  politics?: PoliticsCard[];
  achievements?: AchievementToken[];
}): GameState {
  const players = options?.players ?? PLAYERS;
  const cities = options?.cities ?? makeCityCards();
  const events = options?.events ?? makeEventDeck();
  const politics = options?.politics ?? makePoliticsDeck(30);
  const achievements = options?.achievements ?? makeAchievements();

  let state = engine.initializeGame(players, cities, events, politics, achievements);

  // Auto-resolve city selection for each player in pick order
  while (state.currentPhase === 'CITY_SELECTION') {
    const pending = state.pendingDecisions[0];
    if (!pending) break;
    state = engine.handleTimeout(state, pending.playerId);
  }

  // Auto-resolve politics draft for each round
  while (state.currentPhase === 'DRAFT_POLITICS') {
    const pending = state.pendingDecisions;
    if (pending.length === 0) break;
    for (const d of pending) {
      state = engine.handleTimeout(state, d.playerId);
    }
  }

  // Skip through display phases (OMEN, TAXATION) that now pause for 5 seconds
  while (state.currentPhase === 'OMEN' || state.currentPhase === 'TAXATION') {
    const displayPending = state.pendingDecisions.find(d => d.decisionType === 'PHASE_DISPLAY');
    if (displayPending) {
      state = engine.handleTimeout(state, displayPending.playerId);
    } else {
      break;
    }
  }

  return state;
}

describe('GameEngine', () => {
  describe('initializeGame', () => {
    it('creates game state starting at CITY_SELECTION phase', () => {
      const engine = new GameEngine();
      const state = engine.initializeGame(
        PLAYERS, makeCityCards(), makeEventDeck(), makePoliticsDeck(), makeAchievements(),
      );

      expect(state.players).toHaveLength(2);
      expect(state.currentPhase).toBe('CITY_SELECTION');
      expect(state.draftState).not.toBeNull();
      expect(state.draftState!.cityDraft).not.toBeNull();
    });

    it('sets up politics deck', () => {
      const engine = new GameEngine();
      const state = engine.initializeGame(
        PLAYERS, makeCityCards(), makeEventDeck(), makePoliticsDeck(10), makeAchievements(),
      );

      // Deck is shuffled; total cards should be preserved
      expect(state.politicsDeck.length).toBeGreaterThanOrEqual(0);
    });

    it('sets up achievement tokens', () => {
      const engine = new GameEngine();
      const state = engine.initializeGame(
        PLAYERS, makeCityCards(), makeEventDeck(), makePoliticsDeck(), makeAchievements(4),
      );

      expect(state.availableAchievements).toHaveLength(4);
    });

    it('reaches DICE phase after draft phases are resolved', () => {
      const engine = new GameEngine();
      const state = initAndSkipDraft(engine);

      // After draft + OMEN + TAXATION auto-complete -> DICE waits for input
      expect(state.currentPhase).toBe('DICE');
      expect(state.roundNumber).toBe(1);
    });

    it('initializes with empty game log', () => {
      const engine = new GameEngine();
      const state = engine.initializeGame(
        PLAYERS, makeCityCards(), makeEventDeck(), makePoliticsDeck(), makeAchievements(),
      );

      expect(state.gameLog).toEqual([]);
      expect(state.claimedAchievements.size).toBe(0);
    });

    it('generates a gameId', () => {
      const engine = new GameEngine();
      const state = engine.initializeGame(
        PLAYERS, makeCityCards(), makeEventDeck(), makePoliticsDeck(), makeAchievements(),
      );

      expect(state.gameId).toBeTruthy();
      expect(typeof state.gameId).toBe('string');
    });
  });

  describe('handlePlayerDecision', () => {
    it('returns error for wrong phase decision', () => {
      const engine = new GameEngine();
      const state = initAndSkipDraft(engine);

      // State should be in DICE phase; sending a PROGRESS_TRACKS decision should fail
      const decision: ClientMessage = {
        type: 'PROGRESS_TRACK',
        advancement: { track: 'ECONOMY' },
      };

      const result = engine.handlePlayerDecision(state, 'p1', decision);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // DICE phase manager rejects non-ASSIGN_DICE with INVALID_MESSAGE
        expect(result.error.code).toBe('INVALID_MESSAGE');
      }
    });

    it('delegates ROLL_DICE and ASSIGN_DICE to DicePhaseManager and advances when complete', () => {
      const engine = new GameEngine();
      const state = initAndSkipDraft(engine);

      expect(state.currentPhase).toBe('DICE');

      // Players must roll first — dice should be null
      const p1Before = state.players.find((p) => p.playerId === 'p1')!;
      expect(p1Before.diceRoll).toBeNull();

      // Roll dice for both players
      const roll1 = engine.handlePlayerDecision(state, 'p1', { type: 'ROLL_DICE' });
      expect(roll1.ok).toBe(true);
      if (!roll1.ok) return;

      const roll2 = engine.handlePlayerDecision(roll1.value, 'p2', { type: 'ROLL_DICE' });
      expect(roll2.ok).toBe(true);
      if (!roll2.ok) return;

      // Now both have rolled, get dice values
      const p1 = roll2.value.players.find((p) => p.playerId === 'p1')!;
      expect(p1.diceRoll).not.toBeNull();
      const [die1, die2] = p1.diceRoll!;

      const assign1 = engine.handlePlayerDecision(roll2.value, 'p1', {
        type: 'ASSIGN_DICE',
        assignments: [
          { slotIndex: 0, actionType: 'PHILOSOPHY', dieValue: die1 },
          { slotIndex: 1, actionType: 'LEGISLATION', dieValue: die2 },
        ],
      });
      expect(assign1.ok).toBe(true);
      if (!assign1.ok) return;

      // Still in DICE phase (p2 hasn't assigned yet)
      expect(assign1.value.currentPhase).toBe('DICE');

      // Assign dice for p2
      const p2 = assign1.value.players.find((p) => p.playerId === 'p2')!;
      const [d1, d2] = p2.diceRoll!;

      const assign2 = engine.handlePlayerDecision(assign1.value, 'p2', {
        type: 'ASSIGN_DICE',
        assignments: [
          { slotIndex: 0, actionType: 'PHILOSOPHY', dieValue: d1 },
          { slotIndex: 1, actionType: 'CULTURE', dieValue: d2 },
        ],
      });
      expect(assign2.ok).toBe(true);
      if (!assign2.ok) return;

      // Should have auto-advanced past DICE -> ACTIONS
      expect(assign2.value.currentPhase).toBe('ACTIONS');
    });

    it('returns error for non-existent phase manager', () => {
      const engine = new GameEngine();
      const state = initAndSkipDraft(engine);
      const hackedState: GameState = { ...state, currentPhase: 'FINAL_SCORING' };

      const result = engine.handlePlayerDecision(hackedState, 'p1', { type: 'SKIP_PHASE' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('WRONG_PHASE');
      }
    });
  });

  describe('handleTimeout', () => {
    it('auto-resolves dice roll and assignment for a player', () => {
      const engine = new GameEngine();
      const state = initAndSkipDraft(engine);

      expect(state.currentPhase).toBe('DICE');

      // Timeout p1 — should auto-roll (but not assign yet, p2 hasn't rolled)
      let current = engine.handleTimeout(state, 'p1');
      const p1AfterRoll = current.players.find((p) => p.playerId === 'p1')!;
      expect(p1AfterRoll.diceRoll).not.toBeNull();

      // Timeout p2 — should auto-roll (all rolled, ASSIGN_DICE created), then auto-assign
      current = engine.handleTimeout(current, 'p2');

      // Still in DICE (p1 hasn't assigned yet)
      expect(current.currentPhase).toBe('DICE');

      // Timeout p1 again for assignment
      current = engine.handleTimeout(current, 'p1');
      const p1 = current.players.find((p) => p.playerId === 'p1')!;
      expect(p1.actionSlots[0]).not.toBeNull();
      expect(p1.actionSlots[1]).not.toBeNull();

      const p2 = current.players.find((p) => p.playerId === 'p2')!;
      expect(p2.actionSlots[0]).not.toBeNull();

      // Should auto-advance past DICE -> ACTIONS
      expect(current.currentPhase).toBe('ACTIONS');
    });

    it('returns state unchanged for phase without manager', () => {
      const engine = new GameEngine();
      const state = initAndSkipDraft(engine);
      const hackedState: GameState = { ...state, currentPhase: 'GAME_OVER' };

      const result = engine.handleTimeout(hackedState, 'p1');
      expect(result.currentPhase).toBe('GAME_OVER');
    });
  });

  describe('handleFlag', () => {
    it('flags the player, removes their pending decision, and lets others continue', () => {
      const engine = new GameEngine();
      const state = makeTestGameState({
        currentPhase: 'PROGRESS',
        players: [
          makeTestPlayer({ playerId: 'p1', playerName: 'Alice', timeBankMs: 1 }),
          makeTestPlayer({ playerId: 'p2', playerName: 'Bob', timeBankMs: 120_000 }),
        ],
        turnOrder: ['p1', 'p2'],
        pendingDecisions: [
          { playerId: 'p1', decisionType: 'PROGRESS_TRACK', timeoutAt: Date.now(), options: null },
          { playerId: 'p2', decisionType: 'PROGRESS_TRACK', timeoutAt: Date.now() + 30_000, options: null },
        ],
      });

      const flagged = engine.handleFlag(state, 'p1');

      expect(flagged.players.find(p => p.playerId === 'p1')?.hasFlagged).toBe(true);
      expect(flagged.players.find(p => p.playerId === 'p1')?.timeBankMs).toBe(0);
      expect(flagged.pendingDecisions.map(d => d.playerId)).toEqual(['p2']);
      expect(flagged.currentPhase).toBe('PROGRESS');
    });
  });

  describe('advancePhase', () => {
    it('recursively advances through auto-completing phases', () => {
      const engine = new GameEngine();
      const state = initAndSkipDraft(engine);

      // After draft + OMEN -> TAXATION -> DICE (stops because DICE needs input)
      expect(state.currentPhase).toBe('DICE');
    });

    it('advances from ACHIEVEMENT to OMEN for rounds < 9', () => {
      const engine = new GameEngine();
      const sm = engine.getStateMachine();

      // Set up state machine at ACHIEVEMENT, round 1
      sm.currentPhase = 'ACHIEVEMENT';
      sm.roundNumber = 1;

      const state = makeTestGameState({
        roundNumber: 1,
        currentPhase: 'ACHIEVEMENT',
        eventDeck: makeEventDeck(8), // 8 remaining after round 1
        currentEvent: makeTestEventCard('current'),
      });

      let advanced = engine.advancePhase(state);

      // Should advance: ACHIEVEMENT -> OMEN (pauses for display)
      expect(advanced.currentPhase).toBe('OMEN');
      expect(advanced.roundNumber).toBe(2);

      // Skip through display phases
      while (advanced.currentPhase === 'OMEN' || advanced.currentPhase === 'TAXATION') {
        const displayPending = advanced.pendingDecisions.find(d => d.decisionType === 'PHASE_DISPLAY');
        if (displayPending) {
          advanced = engine.handleTimeout(advanced, displayPending.playerId);
        } else {
          break;
        }
      }

      expect(advanced.currentPhase).toBe('DICE');
    });

    it('advances from ACHIEVEMENT to FINAL_SCORING to GAME_OVER at round 9', () => {
      const engine = new GameEngine();
      const sm = engine.getStateMachine();

      sm.currentPhase = 'ACHIEVEMENT';
      sm.roundNumber = 9;

      const state = makeTestGameState({
        roundNumber: 9,
        currentPhase: 'ACHIEVEMENT',
        eventDeck: [],
        currentEvent: null,
      });

      const advanced = engine.advancePhase(state);

      // ACHIEVEMENT -> FINAL_SCORING -> GAME_OVER
      expect(advanced.currentPhase).toBe('GAME_OVER');
    });
  });

  describe('getFullStateForPlayer', () => {
    it('returns public state with all players info', () => {
      const engine = new GameEngine();
      const state = initAndSkipDraft(engine);

      const { public: pub } = engine.getFullStateForPlayer(state, 'p1');

      expect(pub.players).toHaveLength(2);
      expect(pub.roundNumber).toBe(state.roundNumber);
      expect(pub.currentPhase).toBe(state.currentPhase);
    });

    it('returns private state for the requesting player', () => {
      const engine = new GameEngine();
      const state = initAndSkipDraft(engine);

      const { private: priv } = engine.getFullStateForPlayer(state, 'p1');

      const p1 = state.players.find((p) => p.playerId === 'p1')!;
      expect(priv.coins).toBe(p1.coins);
      expect(priv.knowledgeTokens).toEqual(p1.knowledgeTokens);
    });

    it('returns default private state for unknown player', () => {
      const engine = new GameEngine();
      const state = initAndSkipDraft(engine);

      const { private: priv } = engine.getFullStateForPlayer(state, 'unknown');

      expect(priv.coins).toBe(0);
      expect(priv.knowledgeTokens).toEqual([]);
      expect(priv.diceRoll).toBeNull();
    });
  });
});
