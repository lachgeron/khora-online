import { useEffect, useRef, useState, useCallback } from 'react';
import type { ClientMessage, PublicGameState, PrivatePlayerState, ScoreSolverResult, ServerMessage } from '@khora/shared';

export function analysisBudget(timeoutAt: number | undefined, now = Date.now()): number {
  // Leave two seconds for the player to read and act. Background searches get 30s.
  return timeoutAt === undefined ? 30_000 : Math.max(50, Math.min(30_000, timeoutAt - now - 2_000));
}

export function useScoreSolver({ gameId, playerId, connected, gameState, privateState, snapshot, sendMessage }: {
  gameId: string | null; playerId: string | null; connected: boolean;
  gameState: PublicGameState | null; privateState: PrivatePlayerState | null;
  snapshot: Extract<ServerMessage, { type: 'SOLVER_SNAPSHOT' }> | null;
  sendMessage: (message: ClientMessage) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [result, setResult] = useState<ScoreSolverResult | null>(null);
  const [refresh, setRefresh] = useState(0);
  const worker = useRef<Worker | null>(null);
  const currentRequest = useRef('');
  const counter = useRef(0);
  const clientId = useRef(crypto.randomUUID());
  const refreshNow = useCallback(() => setRefresh(n => n + 1), []);

  useEffect(() => {
    if (!enabled || !connected || !gameId || !playerId) {
      worker.current?.terminate(); worker.current = null;
      currentRequest.current = '';
      setResult(null);
      return;
    }
    const instance = new Worker(new URL('./scoreSolver.worker.ts', import.meta.url), { type: 'module' });
    worker.current = instance;
    instance.onmessage = (event: MessageEvent<ScoreSolverResult>) => {
      if (event.data.requestId === currentRequest.current) setResult(event.data);
    };
    instance.onerror = event => {
      setResult({ requestId: currentRequest.current, status: 'ERROR', immediateMove: null, path: [], projectedScore: null,
        completedRollouts: 0, evaluatedMoves: 0, elapsedMs: 0, assumesFutureDraftDraws: false, message: event.message || 'Unable to start analysis.' });
    };
    return () => { instance.terminate(); worker.current = null; currentRequest.current = ''; };
  }, [enabled, connected, gameId, playerId]);

  useEffect(() => {
    if (!enabled || !connected || !gameId || !playerId || !gameState) return;
    const id = `${clientId.current}:${gameId}:${playerId}:${++counter.current}`;
    currentRequest.current = id;
    setResult(null);
    sendMessage({ type: 'SOLVER_SNAPSHOT_REQUEST', requestId: id });
  }, [enabled, connected, gameId, playerId, gameState, privateState, refresh, sendMessage]);

  useEffect(() => {
    if (!snapshot || snapshot.requestId !== currentRequest.current || !worker.current || !playerId) return;
    const pending = gameState?.pendingDecisions.find(d => d.playerId === playerId && d.decisionType !== 'PHASE_DISPLAY');
    worker.current.postMessage({ ...snapshot, playerId, budgetMs: analysisBudget(pending?.timeoutAt) });
  }, [snapshot, playerId, gameState]);

  // Suppress stale results during the render before the new request effect runs.
  const source = useRef(gameState);
  const fresh = source.current === gameState;
  useEffect(() => { source.current = gameState; }, [gameState]);
  return { enabled, setEnabled, result: fresh && connected ? result : null, refreshNow };
}
