import { readFileSync } from 'node:fs';
import { GameServer, makeDefaultCentralBoardTokens } from '../packages/server/src/integration';
import { ALL_CITIES } from '../packages/server/src/game-data';
import { __liveSolverInternals, runLiveSolver, validateLiveSolverLine } from '../packages/server/src/live-solver';
import { applyDevelopmentEffect } from '../packages/server/src/city-abilities';
import type { GameState, LiveSolverReferenceLine, LiveSolverResult } from '@khora/shared';

function loadReferenceLines(): LiveSolverReferenceLine[] {
  const payload = JSON.parse(readFileSync('packages/client/public/live-solver-reference-lines.json', 'utf8')) as {
    lines?: LiveSolverReferenceLine[];
    records?: Array<{
      score: number;
      projectedMargin: number | null;
      cityId?: string;
      tags?: string[];
      rounds?: Array<{ moves: LiveSolverReferenceLine['moves'] }>;
    }>;
  };

  if (Array.isArray(payload.lines)) return payload.lines;
  return (payload.records ?? []).map(record => ({
    score: record.score,
    projectedMargin: record.projectedMargin,
    cityId: record.cityId,
    tags: record.tags,
    moves: (record.rounds ?? []).flatMap(round => round.moves ?? []),
  }));
}

function advanceDisplays(server: GameServer, state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (
    guard++ < 12
    && current.pendingDecisions.length === 1
    && current.pendingDecisions[0]?.decisionType === 'PHASE_DISPLAY'
  ) {
    current = server.engine.handleTimeout(current, '__display__');
  }
  return current;
}

function stateForCity(cityId: string): { state: GameState; playerId: string } {
  const server = new GameServer();
  let state = server.createAndStartGame(['Target', 'Opponent'], {
    centralBoardTokens: makeDefaultCentralBoardTokens(),
  });
  state = advanceDisplays(server, state);
  const playerId = state.players[0]!.playerId;
  const targetCity = ALL_CITIES.find(city => city.id === cityId);
  if (!targetCity) throw new Error(`Unknown city ${cityId}`);
  const baseTarget = state.players[0]!;
  const baseOpponent = state.players[1]!;
  const target = applyDevelopmentEffect({
    ...baseTarget,
    cityId,
    coins: targetCity.startingCoins,
    economyTrack: targetCity.startingTracks.economy,
    cultureTrack: targetCity.startingTracks.culture,
    militaryTrack: targetCity.startingTracks.military,
    taxTrack: targetCity.startingTracks.tax,
    gloryTrack: targetCity.startingTracks.glory,
    troopTrack: targetCity.startingTracks.troop,
    citizenTrack: targetCity.startingTracks.citizen,
    victoryPoints: 0,
    philosophyTokens: 0,
    knowledgeTokens: [],
    playedCards: [],
    actionSlots: [null, null, null] as typeof baseTarget.actionSlots,
    diceRoll: null,
    diceRollHistory: [],
    developmentLevel: 1,
  }, targetCity.developments[0]!);
  return {
    playerId,
    state: {
      ...state,
      currentPhase: 'DICE',
      pendingDecisions: [
        { playerId, decisionType: 'ROLL_DICE', timeoutAt: Date.now() + 60_000, options: null },
        { playerId: baseOpponent.playerId, decisionType: 'ROLL_DICE', timeoutAt: Date.now() + 60_000, options: null },
      ],
      players: [target, { ...baseOpponent, cityId: 'argos' }],
    },
  };
}

function ownScore(result: LiveSolverResult, playerId: string): number {
  return result.projections.find(score => score.playerId === playerId)?.projectedTotal ?? Number.NEGATIVE_INFINITY;
}

function firstMoves(result: LiveSolverResult): string[] {
  return result.rounds.flatMap(round => round.moves).slice(0, 6).map(move => move.instruction);
}

const referenceLines = loadReferenceLines();
const cityArgIndex = process.argv.indexOf('--city');
const budgetArgIndex = process.argv.indexOf('--budget-ms');
const seedArgIndex = process.argv.indexOf('--seed');
const cityIds = cityArgIndex >= 0 && process.argv[cityArgIndex + 1]
  ? [process.argv[cityArgIndex + 1]!]
  : ['athens', 'corinth', 'miletus', 'sparta', 'olympia', 'argos', 'thebes'];
const budgetMs = budgetArgIndex >= 0 && process.argv[budgetArgIndex + 1]
  ? Number(process.argv[budgetArgIndex + 1])
  : 10_000;
const seed = seedArgIndex >= 0 && process.argv[seedArgIndex + 1]
  ? Number(process.argv[seedArgIndex + 1])
  : 1;
const printFull = process.argv.includes('--full');
const printCandidates = process.argv.includes('--candidates');

console.log(`loaded ${referenceLines.length} runtime reference lines; seed=${seed}`);
for (let cityIndex = 0; cityIndex < cityIds.length; cityIndex++) {
  const cityId = cityIds[cityIndex]!;
  const { state, playerId } = withSeededRandom(seed + cityIndex * 1009, () => stateForCity(cityId));
  if (printCandidates) {
    const targetRolled = __liveSolverInternals.applyMessage(state, playerId, { type: 'ROLL_DICE' });
    const opponentId = state.players.find(player => player.playerId !== playerId)?.playerId;
    const rolled = targetRolled && opponentId
      ? __liveSolverInternals.applyMessage(targetRolled, opponentId, { type: 'ROLL_DICE' })
      : targetRolled;
    const assignCandidates = rolled
      ? __liveSolverInternals.orderSearchCandidates(rolled, playerId, 'ASSIGN_DICE', playerId, true).slice(0, 20)
      : [];
    console.log(JSON.stringify({
      cityId,
      dice: rolled?.players.find(player => player.playerId === playerId)?.diceRoll,
      topAssignCandidates: assignCandidates.map(candidate => ({
        quickScore: candidate.quickScore,
        instruction: candidate.instruction,
        detail: candidate.detail,
        message: candidate.message,
      })),
    }, null, 2));
  }
  const start = Date.now();
  let bestProgress: LiveSolverResult | null = null;
  const result = runLiveSolver(state, playerId, `diagnostic-${cityId}`, {
    timeBudgetMs: budgetMs,
    beamWidth: 192,
    targetBranches: 48,
    opponentBranches: 1,
    completionWidth: 64,
    maxDecisionPlies: 1200,
    exactTimeBudgetMs: 0,
    exactNodeLimit: 0,
    skipExactSearch: true,
    referenceLines,
    referenceLineWeight: 32,
  }, progress => {
    if (!bestProgress || ownScore(progress, playerId) > ownScore(bestProgress, playerId)) {
      bestProgress = progress;
    }
  });
  const best = bestProgress && ownScore(bestProgress, playerId) > ownScore(result, playerId)
    ? bestProgress
    : result;
  const moves = best.rounds.flatMap(round => round.moves);
  const validation = validateLiveSolverLine(state, playerId, moves);
  console.log(JSON.stringify({
    cityId,
    score: ownScore(best, playerId),
    margin: best.projectedMargin,
    horizon: best.horizon,
    completedLines: best.completedLines,
    searchedNodes: best.searchedNodes,
    elapsedMs: Date.now() - start,
    valid: validation.valid,
    failedMoveIndex: validation.failedMoveIndex,
    firstMoves: firstMoves(best),
  }));
  if (printFull) {
    console.log(JSON.stringify(best.rounds.map(round => ({
      round: round.round,
      moves: round.moves.map(move => ({
        phase: move.phase,
        instruction: move.instruction,
        detail: move.detail,
        message: move.message,
      })),
    })), null, 2));
  }
}

function withSeededRandom<T>(seedValue: number, run: () => T): T {
  const originalRandom = Math.random;
  let state = seedValue >>> 0;
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  try {
    return run();
  } finally {
    Math.random = originalRandom;
  }
}
