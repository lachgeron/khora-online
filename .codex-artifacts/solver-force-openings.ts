import { readFileSync } from 'node:fs';
import { GameServer, makeDefaultCentralBoardTokens } from '../packages/server/src/integration';
import { ALL_CITIES } from '../packages/server/src/game-data';
import { __liveSolverInternals, runLiveSolver } from '../packages/server/src/live-solver';
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

function stateForCity(cityId: string): { state: GameState; playerId: string; opponentId: string } {
  const server = new GameServer();
  let state = server.createAndStartGame(['Target', 'Opponent'], {
    centralBoardTokens: makeDefaultCentralBoardTokens(),
  });
  state = advanceDisplays(server, state);
  const playerId = state.players[0]!.playerId;
  const opponentId = state.players[1]!.playerId;
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
    opponentId,
    state: {
      ...state,
      currentPhase: 'DICE',
      pendingDecisions: [
        { playerId, decisionType: 'ROLL_DICE', timeoutAt: Date.now() + 60_000, options: null },
        { playerId: opponentId, decisionType: 'ROLL_DICE', timeoutAt: Date.now() + 60_000, options: null },
      ],
      players: [target, { ...baseOpponent, cityId: 'argos' }],
    },
  };
}

function ownScore(result: LiveSolverResult, playerId: string): number {
  return result.projections.find(score => score.playerId === playerId)?.projectedTotal ?? Number.NEGATIVE_INFINITY;
}

function firstMoves(result: LiveSolverResult): string[] {
  return result.rounds.flatMap(round => round.moves).slice(0, 8).map(move => move.instruction);
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

const referenceLines = loadReferenceLines();
const cityArgIndex = process.argv.indexOf('--city');
const seedArgIndex = process.argv.indexOf('--seed');
const budgetArgIndex = process.argv.indexOf('--budget-ms');
const inspect = process.argv.includes('--inspect');
const scoreActions = process.argv.includes('--score-actions');
const cityIds = cityArgIndex >= 0 && process.argv[cityArgIndex + 1]
  ? [process.argv[cityArgIndex + 1]!]
  : ['olympia', 'athens', 'argos'];
const seed = seedArgIndex >= 0 && process.argv[seedArgIndex + 1]
  ? Number(process.argv[seedArgIndex + 1])
  : 42;
const budgetMs = budgetArgIndex >= 0 && process.argv[budgetArgIndex + 1]
  ? Number(process.argv[budgetArgIndex + 1])
  : 12_000;

for (const cityId of cityIds) {
  const { state, playerId, opponentId } = withSeededRandom(seed, () => stateForCity(cityId));
  const targetRolled = __liveSolverInternals.applyMessage(state, playerId, { type: 'ROLL_DICE' });
  const rolled = targetRolled
    ? __liveSolverInternals.applyMessage(targetRolled, opponentId, { type: 'ROLL_DICE' })
    : null;
  if (!rolled) throw new Error('Could not roll dice');
  const assignments = __liveSolverInternals.orderSearchCandidates(rolled, playerId, 'ASSIGN_DICE', playerId, true);
  const openings = assignments
    .filter(candidate => candidate.instruction.includes('Development') || candidate.instruction.includes('Trade and 5 to Military'))
    .slice(0, 6);

  console.log(JSON.stringify({
    cityId,
    dice: rolled.players.find(player => player.playerId === playerId)?.diceRoll,
    openings: openings.map(candidate => candidate.instruction),
  }));

  for (const opening of openings) {
    const afterOpening = __liveSolverInternals.applyMessage(rolled, playerId, opening.message);
    if (!afterOpening) continue;
    if (inspect) {
      const opponentDecision = afterOpening.pendingDecisions.find(decision =>
        decision.playerId === opponentId && decision.decisionType === 'ASSIGN_DICE');
      const opponentCandidate = opponentDecision
        ? __liveSolverInternals.orderSearchCandidates(afterOpening, opponentId, 'ASSIGN_DICE', playerId, false)[0]
        : null;
      const afterOpponent = opponentCandidate
        ? __liveSolverInternals.applyMessage(afterOpening, opponentId, opponentCandidate.message)
        : afterOpening;
      let normalized = afterOpponent;
      for (let guard = 0; guard < 24 && normalized && !normalized.pendingDecisions.some(decision => decision.playerId === playerId && decision.decisionType !== 'PHASE_DISPLAY'); guard++) {
        const display = normalized.pendingDecisions.find(decision => decision.decisionType === 'PHASE_DISPLAY');
        if (display) {
          normalized = __liveSolverInternals.autoResolve(normalized, display.playerId);
          continue;
        }
        const opponentReal = normalized.pendingDecisions.find(decision => decision.playerId !== playerId && decision.decisionType !== 'PHASE_DISPLAY');
        if (!opponentReal) break;
        const opponentStep = __liveSolverInternals.orderSearchCandidates(
          normalized,
          opponentReal.playerId,
          opponentReal.decisionType,
          playerId,
          false,
        )[0];
        if (!opponentStep) break;
        normalized = __liveSolverInternals.applyMessage(normalized, opponentReal.playerId, opponentStep.message);
      }
      const actionCandidates = afterOpponent
        ? __liveSolverInternals.orderSearchCandidates(normalized!, playerId, 'RESOLVE_ACTION', playerId, true)
        : [];
      console.log(JSON.stringify({
        cityId,
        opening: opening.instruction,
        opponent: opponentCandidate?.instruction ?? null,
        pending: normalized?.pendingDecisions.map(decision => `${decision.playerId === playerId ? 'target' : 'opponent'}:${decision.decisionType}`),
        target: normalized?.players.find(player => player.playerId === playerId),
        actionCandidates: actionCandidates.slice(0, 10).map(candidate => ({
          instruction: candidate.instruction,
          quickScore: candidate.quickScore,
          cityBonus: __liveSolverInternals.cityStrategyCandidateBonus(normalized!, playerId, candidate),
          message: candidate.message,
        })),
      }, null, 2));
      if (scoreActions && normalized) {
        for (const actionCandidate of actionCandidates.slice(0, 4)) {
          const afterAction = __liveSolverInternals.applyMessage(normalized, playerId, actionCandidate.message);
          if (!afterAction) continue;
          let bestProgress: LiveSolverResult | null = null;
          const result = runLiveSolver(afterAction, playerId, `force-action-${cityId}`, {
            timeBudgetMs: budgetMs,
            beamWidth: 192,
            targetBranches: 64,
            opponentBranches: 1,
            completionWidth: 80,
            maxDecisionPlies: 1400,
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
          console.log(JSON.stringify({
            cityId,
            opening: opening.instruction,
            action: actionCandidate.instruction,
            score: ownScore(best, playerId),
            completedLines: best.completedLines,
            firstMoves: firstMoves(best),
          }));
        }
      }
      continue;
    }
    let bestProgress: LiveSolverResult | null = null;
    const result = runLiveSolver(afterOpening, playerId, `force-${cityId}`, {
      timeBudgetMs: budgetMs,
      beamWidth: 192,
      targetBranches: 64,
      opponentBranches: 1,
      completionWidth: 80,
      maxDecisionPlies: 1400,
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
    console.log(JSON.stringify({
      cityId,
      opening: opening.instruction,
      score: ownScore(best, playerId),
      completedLines: best.completedLines,
      firstMoves: firstMoves(best),
    }));
  }
}
