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
}

const workerScope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse): void;
};

workerScope.addEventListener('message', (event) => {
  const { requestId, playerId, snapshot, options } = event.data;
  try {
    const state = gameStateFromLiveSolverSnapshot(snapshot);
    const result = runLiveSolver(state, playerId, requestId, options);
    workerScope.postMessage({ requestId, result });
  } catch (error) {
    workerScope.postMessage({
      requestId,
      result: errorResult(requestId, playerId, error),
    });
  }
});

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
    opponentModel: 'MAXIMIZE_MARGIN_AGAINST_ADVERSARIAL_FIELD',
  };
}
