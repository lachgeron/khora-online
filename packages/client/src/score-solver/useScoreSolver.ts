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
  const [enabledGameId, setEnabledGameId] = useState<string | null>(null);
  const enabled = gameId !== null && enabledGameId === gameId;
  const setEnabled = useCallback((value: boolean) => setEnabledGameId(value ? gameId : null), [gameId]);
  const [result, setResult] = useState<ScoreSolverResult | null>(null);
  const [refresh, setRefresh] = useState(0);
  const worker = useRef<Worker | null>(null);
  const currentRequest = useRef('');
  const receivedSnapshot = useRef('');
  const counter = useRef(0);
  const clientId = useRef(crypto.randomUUID());
  const refreshNow = useCallback(() => setRefresh(n => n + 1), []);

  useEffect(() => {
    setEnabledGameId(null);
    if (!gameId || !playerId) return;

    let apostrophes = 0;
    let lastKeyAt = 0;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (
        event.ctrlKey || event.altKey || event.metaKey || event.isComposing ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        apostrophes = 0;
        return;
      }

      const now = Date.now();
      if (now - lastKeyAt > 2000) apostrophes = 0;
      lastKeyAt = now;
      if (event.key === "'") {
        apostrophes = Math.min(5, apostrophes + 1);
        return;
      }
      if (event.key === '9' && apostrophes === 5) setEnabledGameId(gameId);
      apostrophes = 0;
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameId, playerId]);

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
    const timeout = setTimeout(() => {
      if (currentRequest.current !== id || receivedSnapshot.current === id) return;
      setResult({
        requestId: id, status: 'ERROR', immediateMove: null, path: [], projectedScore: null,
        completedRollouts: 0, evaluatedMoves: 0, elapsedMs: 5000, assumesFutureDraftDraws: false,
        message: 'The game server did not respond to the analysis request. Check that the latest game server version is running, then refresh.',
      });
    }, 5000);
    return () => clearTimeout(timeout);
  }, [enabled, connected, gameId, playerId, gameState, privateState, refresh, sendMessage]);

  useEffect(() => {
    if (!snapshot || snapshot.requestId !== currentRequest.current || !worker.current || !playerId) return;
    receivedSnapshot.current = snapshot.requestId;
    const pending = gameState?.pendingDecisions.find(d => d.playerId === playerId && d.decisionType !== 'PHASE_DISPLAY');
    worker.current.postMessage({ ...snapshot, playerId, budgetMs: analysisBudget(pending?.timeoutAt) });
  }, [snapshot, playerId, gameState]);

  // Suppress stale results during the render before the new request effect runs.
  const source = useRef(gameState);
  const fresh = source.current === gameState;
  useEffect(() => { source.current = gameState; }, [gameState]);
  return { enabled, setEnabled, result: fresh && connected ? result : null, refreshNow };
}
