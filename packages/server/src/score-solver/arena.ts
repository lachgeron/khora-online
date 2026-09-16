import type { ClientMessage } from '@khora/shared';
import { calculateFinalScores } from '../scoring-engine';
import { getActivatableDevs } from '../city-dev-handlers';
import { benchmarkPosition } from './benchmark-position';
import { candidateMessages } from './choices';
import { potential, priority } from './reference-evaluation';
import { ScoreSearch } from './search';
import { settle, simulate, type SearchState } from './simulation';

function actor(state: SearchState): string | undefined {
  return state.pendingDecisions.find(d => d.playerId === 'player-1' && d.decisionType !== 'PHASE_DISPLAY')?.playerId
    ?? state.players.find(p => p.playerId === 'player-1' && !p.hasFlagged
      && !state.analysisPassed?.includes(p.playerId) && getActivatableDevs(p).length)?.playerId
    ?? state.pendingDecisions.find(d => d.decisionType !== 'PHASE_DISPLAY')?.playerId
    ?? state.players.find(p => !p.hasFlagged && !state.analysisPassed?.includes(p.playerId) && getActivatableDevs(p).length)?.playerId;
}

/** Deterministic opponent, unaffected by tree-search changes or thinking budgets. */
function policyMove(state: SearchState, playerId: string, strategy: number): ClientMessage | null {
  const player = state.players.find(p => p.playerId === playerId)!;
  const ranked = [...candidateMessages(state, playerId)]
    .map(message => ({ message, value: priority(state, player, message, strategy) }))
    .sort((a, b) => b.value - a.value);
  const messages: (ClientMessage | null)[] = ranked.slice(0, 16).map(r => r.message);
  if (!state.pendingDecisions.some(d => d.playerId === playerId && d.decisionType !== 'PHASE_DISPLAY')) messages.push(null);
  let best: ClientMessage | null | undefined;
  let value = -Infinity;
  for (const message of messages) {
    const child = message ? simulate(state, playerId, message)
      : { ...state, analysisPassed: [...state.analysisPassed ?? [], playerId] };
    if (!child) continue;
    const next = settle(child, true);
    let score = potential(next, next.players.find(p => p.playerId === playerId)!, strategy);
    if (message?.type === 'ASSIGN_DICE' || (message?.type === 'PROGRESS_TRACK' && next.progressSubmissions?.[playerId])
      || message?.type === 'DRAFT_CARD' || message?.type === 'PICK_BAN_CARD') score += priority(state, player, message, strategy);
    if (score > value) { best = message; value = score; }
  }
  if (best === undefined) throw new Error(`Reference policy has no move in ${state.currentPhase}`);
  return best;
}

/** Play a full game, replanning after every opponent move; report actual final points. */
export function playBenchmark(city: string, seed: number, budgetMs: number, opponentStrategy = 0, playerCount = 2) {
  let state: SearchState = benchmarkPosition(city, seed, playerCount);
  const search = new ScoreSearch();
  let searches = 0, fallbacks = 0, searchMs = 0, maxSearchMs = 0, trials = 0;
  for (let turn = 0; turn < 800 && state.currentPhase !== 'GAME_OVER'; turn++) {
    state = settle(state, true);
    if (state.currentPhase === 'GAME_OVER') break;
    const playerId = actor(state);
    if (!playerId) throw new Error(`No actor in ${state.currentPhase}`);
    let message: ClientMessage | null;
    if (playerId === 'player-1' && budgetMs > 0) {
      const started = performance.now();
      search.reset(state, playerId, String(turn));
      const work = search.work();
      while (performance.now() - started < budgetMs) if (work.next().done) break;
      const result = search.result('PAUSED');
      const duration = performance.now() - started;
      searches++; searchMs += duration; maxSearchMs = Math.max(maxSearchMs, duration); trials += result.completedRollouts;
      if (result.immediateMove) message = result.immediateMove.message;
      else if (!state.pendingDecisions.some(d => d.playerId === playerId && d.decisionType !== 'PHASE_DISPLAY') && result.projectedScore !== null) message = null;
      else { fallbacks++; message = policyMove(state, playerId, 0); }
    } else message = policyMove(state, playerId, playerId === 'player-1' ? 0 : opponentStrategy);
    const next = message ? simulate(state, playerId, message)
      : { ...state, analysisPassed: [...state.analysisPassed ?? [], playerId] };
    if (!next) throw new Error(`Illegal arena move: ${JSON.stringify(message)}`);
    state = next;
  }
  if (state.currentPhase !== 'GAME_OVER') throw new Error('Arena exceeded turn limit');
  const scores = calculateFinalScores(state).rankings;
  return { city, seed, budgetMs, opponentStrategy, playerCount, score: scores.find(s => s.playerId === 'player-1')!.totalPoints,
    opponentScore: scores.find(s => s.playerId === 'player-2')!.totalPoints,
    opponentScores: scores.filter(s => s.playerId !== 'player-1').map(s => ({ playerId: s.playerId, score: s.totalPoints })),
    searches, fallbacks, trials, searchMs: Math.round(searchMs), maxSearchMs: Math.round(maxSearchMs) };
}

if (require.main === module) {
  const budget = Number(process.argv[2] ?? 200);
  const seeds = (process.argv[3] ?? '1,2').split(',').map(Number);
  const cities = (process.argv[4] ?? 'athens,sparta,thebes').split(',');
  const opponent = Number(process.argv[5] ?? 0);
  const playerCount = Number(process.argv[6] ?? 2);
  for (const city of cities) for (const seed of seeds) console.log(JSON.stringify(playBenchmark(city, seed, budget, opponent, playerCount)));
}
