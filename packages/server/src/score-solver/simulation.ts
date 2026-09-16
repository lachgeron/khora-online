import type { ClientMessage, GameState } from '@khora/shared';
import { GameEngine } from '../game-engine';
import { activateDev, getActivatableDevs } from '../city-dev-handlers';
import { serializeGameState, deserializeGameState } from '../serialization';
import { ALL_CITIES, getAllAchievements, STARTING_EVENT, FINAL_EVENT, RANDOM_EVENTS } from '../game-data';

/** Full-information payload, requested explicitly by the analysis panel. */
export function solverSnapshot(state: GameState): string {
  return serializeGameState({ ...state, gameLog: [] });
}

export function restoreSolverSnapshot(json: string): GameState {
  const state = deserializeGameState(json);
  const events = new Map([STARTING_EVENT, FINAL_EVENT, ...RANDOM_EVENTS].map(e => [e.id, e]));
  const achievements = new Map(getAllAchievements().map(a => [a.id, a]));
  const cities = new Map(ALL_CITIES.map(c => [c.id, c]));
  const event = (e: GameState['currentEvent']) => {
    if (!e) return null;
    const restored = events.get(e.id);
    if (!restored) throw new Error(`Unknown event: ${e.id}`);
    return restored;
  };
  const achievement = (a: GameState['availableAchievements'][number]) => {
    const restored = achievements.get(a.id);
    if (!restored) throw new Error(`Unknown achievement: ${a.id}`);
    return restored;
  };
  state.eventDeck = state.eventDeck.map(e => event(e)!);
  state.currentEvent = event(state.currentEvent);
  state.availableAchievements = state.availableAchievements.map(achievement);
  state.claimedAchievements = new Map([...state.claimedAchievements].map(([id, list]) => [id, list.map(achievement)]));
  if (state.draftState?.cityDraft) {
    const draft = state.draftState.cityDraft;
    draft.allCities = draft.allCities.map(c => cities.get(c.id) ?? c);
    draft.remainingPool = draft.remainingPool.map(c => cities.get(c.id) ?? c);
  }
  return state;
}

const identities = new WeakMap<GameState, string>();
export type SearchState = GameState & { analysisPassed?: string[] };
export function positionKey(state: GameState): string {
  const cached = identities.get(state);
  if (cached) return cached;
  const key = JSON.stringify({
    ...state, gameLog: [], createdAt: 0, updatedAt: 0,
    players: state.players.map(p => ({ ...p, timeBankMs: 0, diceRollHistory: [] })),
    pendingDecisions: state.pendingDecisions.map(d => ({ ...d, timeoutAt: 0, usingTimeBank: false })),
    suspendedDecisions: state.suspendedDecisions?.map(d => ({ ...d, timeoutAt: 0, usingTimeBank: false })),
    claimedAchievements: [...state.claimedAchievements],
    disconnectedPlayers: [...state.disconnectedPlayers.keys()],
  });
  identities.set(state, key);
  return key;
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

const engines = new Map<string, GameEngine>();
/** Synchronous and worker-only in production. Restore globals even when a rule throws.
 * Fixing time/randomness makes generated token IDs and assumed future draft draws replayable.
 * This never changes the live game's clock or random generator (a separate JS realm).
 */
export function simulate(state: GameState, playerId: string, message: ClientMessage | null): GameState | null {
  // Passing an optional activation window is search metadata, never a game rule.
  if ((state as SearchState).analysisPassed) state = { ...state, analysisPassed: undefined } as SearchState;
  const oldRandom = Math.random;
  const oldNow = Date.now;
  let seed = hash(positionKey(state));
  Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  Date.now = () => 1_700_000_000_000 + hash(positionKey(state));
  try {
    let engine = engines.get(state.draftMode);
    if (!engine) { engine = new GameEngine(state.draftMode); engines.set(state.draftMode, engine); }
    engine.getStateMachine().currentPhase = state.currentPhase;
    engine.getStateMachine().roundNumber = state.roundNumber;
    let next: GameState;
    if (message?.type === 'ACTIVATE_DEV') {
      const player = state.players.find(p => p.playerId === playerId);
      if (!player || player.hasFlagged || state.currentPhase === 'GAME_OVER' || !getActivatableDevs(player).includes(message.devId)) return null;
      next = activateDev(state, playerId, message.devId);
    } else if (message) {
      const result = engine.handlePlayerDecision(state, playerId, message);
      if (!result.ok) return null;
      next = result.value;
    } else if (state.pendingDecisions.length) {
      next = engine.handleTimeout(state, playerId);
    } else {
      next = engine.advancePhase(state);
    }
    return next === state ? null : { ...next, gameLog: [] };
  } finally {
    Math.random = oldRandom;
    Date.now = oldNow;
  }
}

/** Only automatic display pauses are skipped; actual choices always use legal messages. */
export function settle(state: SearchState, offerAbilities = false): SearchState {
  for (let i = 0; i < 40 && state.currentPhase !== 'GAME_OVER'; i++) {
    if (state.pendingDecisions.some(d => d.decisionType !== 'PHASE_DISPLAY')) return state;
    if (offerAbilities && state.players.some(p => !p.hasFlagged && !state.analysisPassed?.includes(p.playerId) && getActivatableDevs(p).length)) return state;
    const next = simulate(state, state.pendingDecisions[0]?.playerId ?? '', null);
    if (!next) throw new Error(`Simulation stalled in ${state.currentPhase}.`);
    state = next;
  }
  return state;
}
