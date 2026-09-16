import { describe, expect, it } from 'vitest';
import type { GameState } from '@khora/shared';
import { __liveSolverInternals as solver, createLiveSolverSearchSession, runLiveSolver, validateLiveSolverLine } from './live-solver';
import { buildLiveSolverSnapshot, gameStateFromLiveSolverSnapshot } from './live-solver-snapshot';
import { ProgressPhaseManager } from './phases/progress-phase';
import { ALL_POLITICS_CARDS, getAllAchievements } from './game-data';
import { makeTestGameState, makeTestKnowledgeToken, makeTestPlayer } from './test-helpers';

function progressState(): GameState {
  const state = makeTestGameState({ currentPhase: 'PROGRESS', roundNumber: 9 });
  return new ProgressPhaseManager().onEnter(state);
}

describe('live solver correctness boundaries', () => {
  it('preserves queued progress across the server-to-worker boundary', () => {
    const manager = new ProgressPhaseManager();
    const queued = manager.handleDecision(progressState(), 'player-1', {
      type: 'PROGRESS_TRACK', advancement: { track: 'ECONOMY' },
    });
    expect(queued.ok).toBe(true);
    if (!queued.ok) return;
    const snapshot = buildLiveSolverSnapshot(queued.value);
    const worker = gameStateFromLiveSolverSnapshot(snapshot);
    const actual = manager.handleDecision(queued.value, 'player-2', { type: 'SKIP_PHASE' });
    const simulated = manager.handleDecision(worker, 'player-2', { type: 'SKIP_PHASE' });
    expect(actual.ok && simulated.ok).toBe(true);
    if (!actual.ok || !simulated.ok) return;
    expect(simulated.value.players[0]).toEqual(actual.value.players[0]);
    expect(simulated.value.players[0].economyTrack).toBe(2);
    worker.progressSubmissions!['player-1'].advancement!.track = 'CULTURE';
    expect(snapshot.progressSubmissions!['player-1'].advancement!.track).toBe('ECONOMY');
    expect(queued.value.progressSubmissions!['player-1'].advancement!.track).toBe('ECONOMY');
  });

  it('values queued progress exactly as the engine will apply it', () => {
    const state = progressState();
    const manager = new ProgressPhaseManager();
    const submission = { advancement: { track: 'ECONOMY' as const } };
    const projected = manager.applySubmissionToPlayer(state.players[0], submission);
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    const queued = { ...state, progressSubmissions: { 'player-1': submission } };
    const applied = { ...state, players: [projected.value, state.players[1]], progressSubmissions: {} };
    expect(solver.heuristicScore(queued, 'player-1')).toBe(solver.heuristicScore(applied, 'player-1'));
    const oldGuard = ALL_POLITICS_CARDS.find(card => card.id === 'old-guard')!;
    const player = makeTestPlayer({ playedCards: [oldGuard] });
    const skipped = { ...state, players: [player, state.players[1]], progressSubmissions: { 'player-1': { skipped: true } } };
    const scored = { ...skipped, players: [{ ...player, victoryPoints: 4 }, state.players[1]], progressSubmissions: {} };
    expect(solver.heuristicScore(skipped, 'player-1')).toBe(solver.heuristicScore(scored, 'player-1'));
  });

  it('includes optional scroll conversions even when the dice already suffice', () => {
    const state = makeTestGameState({
      currentPhase: 'DICE',
      players: [makeTestPlayer({ citizenTrack: 9, philosophyTokens: 1, diceRoll: [6, 6] })],
      pendingDecisions: [{ playerId: 'player-1', decisionType: 'ASSIGN_DICE', options: null, timeoutAt: 0 }],
    });
    const candidates = solver.enumerateExactCandidates(state, 'player-1', 'ASSIGN_DICE');
    const converted = candidates.map(candidate => solver.applyMessage(state, 'player-1', candidate.message))
      .find(next => next?.players[0].citizenTrack === 12 && next.players[0].philosophyTokens === 0);
    expect(converted).toBeDefined();
  });

  it('does not merge positions that differ in achievements, board tail, opponents, or queued progress', () => {
    const state = makeTestGameState({ centralBoardTokens: Array.from({ length: 20 }, (_, i) => makeTestKnowledgeToken({ id: `token-${i}` })) });
    const variants: GameState[] = [
      { ...state, availableAchievements: getAllAchievements() },
      { ...state, centralBoardTokens: state.centralBoardTokens.map((token, i) => i === 19 ? { ...token, explored: true } : token) },
      { ...state, players: [state.players[0], { ...state.players[1], troopTrack: 7 }] },
      { ...state, progressSubmissions: { 'player-1': { advancement: { track: 'ECONOMY' } } } },
    ];
    const original = solver.stateSignature(state);
    for (const variant of variants) expect(solver.stateSignature(variant)).not.toBe(original);
    const nodes = [state, ...variants].map((position, score) => ({ state: position, moves: [], score }));
    expect(solver.rankAndPruneNodes(nodes, 20, 'player-1')).toHaveLength(nodes.length);
  });

  it('keeps the action-aware dice ranking when selecting a rollout', () => {
    const state = makeTestGameState({
      currentPhase: 'DICE', roundNumber: 6,
      players: [makeTestPlayer({ cityId: 'olympia', developmentLevel: 3, cultureTrack: 4, diceRoll: [4, 5, 6] })],
      pendingDecisions: [{ playerId: 'player-1', decisionType: 'ASSIGN_DICE', options: null, timeoutAt: 0 }],
    });
    const ranked = solver.orderSearchCandidates(state, 'player-1', 'ASSIGN_DICE', 'player-1', true);
    const selected = solver.chooseRolloutCandidate(state, 'player-1', 'ASSIGN_DICE', ranked, 'player-1', true, ranked.length);
    expect(selected?.candidate.message).toEqual(ranked[0].message);
    expect(selected?.candidate.message.type).toBe('ASSIGN_DICE');
    if (selected?.candidate.message.type !== 'ASSIGN_DICE') return;
    expect(selected.candidate.message.assignments.some(assignment => assignment.actionType === 'DEVELOPMENT')).toBe(false);
  });

  it('distinguishes exploration tokens with the same color and size', () => {
    const player = makeTestPlayer({ troopTrack: 10, actionSlots: [{ actionType: 'MILITARY', assignedDie: 4, citizenCost: 0, resolved: false }, null, null] });
    const state = makeTestGameState({
      players: [player], currentPhase: 'ACTIONS',
      centralBoardTokens: [
        makeTestKnowledgeToken({ id: 'green-major-a', tokenType: 'MAJOR', militaryRequirement: 5, skullValue: 4, bonusVP: 2 }),
        makeTestKnowledgeToken({ id: 'green-major-b', tokenType: 'MAJOR', militaryRequirement: 6, skullValue: 3, bonusVP: 2 }),
      ],
    });
    const candidates = solver.enumerateExactCandidates(state, player.playerId, 'RESOLVE_ACTION');
    const first = candidates.find(candidate => candidate.message.type === 'RESOLVE_ACTION' && candidate.message.choices.explorationTokenId === 'green-major-a');
    const second = candidates.find(candidate => candidate.message.type === 'RESOLVE_ACTION' && candidate.message.choices.explorationTokenId === 'green-major-b');
    expect(first?.instruction).toContain('requires 5 troops, 4 skulls, +2 VP');
    expect(second?.instruction).toContain('requires 6 troops, 3 skulls, +2 VP');
    expect(first?.instruction).not.toBe(second?.instruction);
  });

  it('rejects incomplete lines, wrong decision rounds, and mismatched advertised scores', () => {
    const state = progressState();
    expect(validateLiveSolverLine(state, 'player-1', []).valid).toBe(false);
    const result = runLiveSolver(state, 'player-1', 'strict', { timeBudgetMs: 80, skipExactSearch: true });
    const moves = result.rounds.flatMap(round => round.moves);
    const score = result.projections.find(projection => projection.playerId === 'player-1')!.projectedTotal;
    expect(result.verifiedFinalScore).toBe(score);
    const validated = validateLiveSolverLine(state, 'player-1', moves, score);
    expect(validated.valid).toBe(true);
    expect(validated.finalState?.currentPhase).toBe('GAME_OVER');
    expect(validated.finalScore).toBe(score);
    expect(validateLiveSolverLine(state, 'player-1', moves, score + 1).valid).toBe(false);
    const first = moves.findIndex(move => move.message !== null);
    expect(first).toBeGreaterThanOrEqual(0);
    const wrongRound = moves.map((move, index) => index === first ? { ...move, round: 8 } : move);
    expect(validateLiveSolverLine(state, 'player-1', wrongRound).valid).toBe(false);
  });

  it('retains verified incumbents between passes and resets on a real position change', () => {
    const state = progressState();
    const session = createLiveSolverSearchSession();
    const options = { timeBudgetMs: 80, skipExactSearch: true };
    const first = runLiveSolver(state, 'player-1', 'first', options, undefined, session);
    const cache = session.heuristicCache;
    const second = runLiveSolver(state, 'player-1', 'second', options, undefined, session);
    expect(second.verifiedFinalScore).toBeGreaterThanOrEqual(first.verifiedFinalScore!);
    expect(session.passes).toBe(2);
    expect(session.heuristicCache).toBe(cache);
    const changed = { ...state, players: state.players.map(player => ({ ...player, coins: player.coins + 1 })) };
    runLiveSolver(changed, 'player-1', 'changed', options, undefined, session);
    expect(session.passes).toBe(1);
    expect(session.heuristicCache).not.toBe(cache);
  });

  it('rejects a missing required decision in the middle of a full-game line', () => {
    const player = makeTestPlayer({ diceRoll: [5, 6], coins: 8 });
    const state = makeTestGameState({
      players: [player], currentPhase: 'DICE', roundNumber: 9,
      pendingDecisions: [{ playerId: player.playerId, decisionType: 'ASSIGN_DICE', options: null, timeoutAt: 0 }],
    });
    const result = runLiveSolver(state, player.playerId, 'omitted-decision', { timeBudgetMs: 80, skipExactSearch: true });
    const moves = result.rounds.flatMap(round => round.moves);
    expect(validateLiveSolverLine(state, player.playerId, moves, result.verifiedFinalScore).valid).toBe(true);
    const incomplete = moves.filter(move => move.decisionType !== 'ASSIGN_DICE');
    expect(incomplete.length).toBeGreaterThan(0);
    expect(validateLiveSolverLine(state, player.playerId, incomplete).valid).toBe(false);
  });
});
