import { gameStateFromLiveSolverSnapshot, runLiveSolver } from '@khora/server';
import type { LiveSolverRequestOptions, LiveSolverResult, LiveSolverSnapshot } from '../types';

interface WorkerRequest {
  requestId: string;
  playerId: string;
  snapshot: LiveSolverSnapshot;
  options: LiveSolverRequestOptions;
}

interface WorkerResponse {
  requestId: string;
  result: LiveSolverResult;
  done?: boolean;
}

const workerScope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse): void;
};

workerScope.addEventListener('message', (event) => {
  const { requestId, playerId, snapshot, options } = event.data;
  try {
    const state = gameStateFromLiveSolverSnapshot(snapshot);
    runProgressiveSearch(state, playerId, requestId, options);
  } catch (error) {
    workerScope.postMessage({
      requestId,
      result: errorResult(requestId, playerId, error),
      done: true,
    });
  }
});

function runProgressiveSearch(
  state: ReturnType<typeof gameStateFromLiveSolverSnapshot>,
  playerId: string,
  requestId: string,
  requestedOptions: LiveSolverRequestOptions,
): void {
  const startedAt = Date.now();
  let cumulativeSearchedNodes = 0;
  let cumulativeProofNodes = 0;
  let bestResult: LiveSolverResult | null = null;

  for (let iteration = 0; ; iteration++) {
    const baseSearchedNodes = cumulativeSearchedNodes;
    const baseProofNodes = cumulativeProofNodes;
    let iterationSearchedNodes = 0;
    let iterationProofNodes = 0;
    const iterationOptions = progressiveOptions(iteration, requestedOptions);

    const publish = (candidate: LiveSolverResult, done = false) => {
      iterationSearchedNodes = Math.max(iterationSearchedNodes, candidate.searchedNodes);
      iterationProofNodes = Math.max(iterationProofNodes, candidate.proofNodes);
      if (!bestResult || resultQuality(candidate) > resultQuality(bestResult)) {
        bestResult = candidate;
      }

      const result = {
        ...(bestResult ?? candidate),
        generatedAt: Date.now(),
        computeMs: Date.now() - startedAt,
        searchedNodes: baseSearchedNodes + iterationSearchedNodes,
        proofNodes: baseProofNodes + iterationProofNodes,
        message: done
          ? (bestResult ?? candidate).message
          : 'Best line found so far. Search is still running; close the panel to stop.',
      };
      workerScope.postMessage({ requestId, result, done });
    };

    const result = runLiveSolver(state, playerId, requestId, iterationOptions, publish);
    publish(result, result.proofStatus === 'PROVEN_OPTIMAL');

    cumulativeSearchedNodes = baseSearchedNodes + Math.max(iterationSearchedNodes, result.searchedNodes);
    cumulativeProofNodes = baseProofNodes + Math.max(iterationProofNodes, result.proofNodes);
    if (result.proofStatus === 'PROVEN_OPTIMAL') return;
  }
}

function progressiveOptions(iteration: number, requested: LiveSolverRequestOptions): LiveSolverRequestOptions {
  const levels: LiveSolverRequestOptions[] = [
    { timeBudgetMs: 1500, beamWidth: 96, targetBranches: 24, completionWidth: 32, maxDecisionPlies: 900 },
    { timeBudgetMs: 5000, beamWidth: 160, targetBranches: 40, completionWidth: 64, maxDecisionPlies: 1500 },
    { timeBudgetMs: 15000, beamWidth: 320, targetBranches: 72, completionWidth: 128, maxDecisionPlies: 2500 },
    { timeBudgetMs: 45000, beamWidth: 512, targetBranches: 96, completionWidth: 192, maxDecisionPlies: 3500 },
    { timeBudgetMs: 120000, beamWidth: 768, targetBranches: 128, completionWidth: 256, maxDecisionPlies: 5000 },
    { timeBudgetMs: 300000, beamWidth: 1024, targetBranches: 160, completionWidth: 320, maxDecisionPlies: 6000 },
  ];
  const level = levels[Math.min(iteration, levels.length - 1)];
  return {
    ...requested,
    ...level,
    opponentBranches: 1,
    exactTimeBudgetMs: 0,
    exactNodeLimit: 0,
    progressIntervalMs: 1000,
    skipExactSearch: true,
  };
}

function resultQuality(result: LiveSolverResult): number {
  if (result.status !== 'READY') return -Infinity;
  const ownProjection = result.projections.find(score => score.playerId === result.playerId);
  return (result.horizon === 'FULL_GAME' ? 1_000_000 : 0)
    + (result.projectedMargin ?? -999) * 1000
    + (ownProjection?.projectedTotal ?? 0);
}

function errorResult(requestId: string, playerId: string, error: unknown): LiveSolverResult {
  const message = error instanceof Error ? error.message : 'Live solver failed in the browser worker.';
  return {
    requestId,
    playerId,
    generatedAt: Date.now(),
    status: 'ERROR',
    message,
    currentMove: null,
    rounds: [],
    projections: [],
    projectedMargin: null,
    searchedNodes: 0,
    completedLines: 0,
    computeMs: 0,
    horizon: 'PARTIAL',
    proofStatus: 'UNPROVEN',
    proofNodes: 0,
    proofReason: message,
    opponentModel: 'LIGHTWEIGHT_ACHIEVEMENT_EVENT_FIELD',
  };
}
