import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveSolverRequestOptions, LiveSolverResult, PrivatePlayerState, PublicGameState } from '../types';
import { useLiveSolverKeybind } from './useLiveSolverKeybind';
import { solverPositionKey } from './solverPosition';

interface LiveSolverMode {
  enabled: boolean;
  toggle: () => void;
  requestNow: () => void;
  pending: boolean;
  result: LiveSolverResult | null;
}

interface UseLiveSolverModeArgs {
  connected: boolean;
  currentPlayerId: string;
  gameState: PublicGameState | null;
  privateState: PrivatePlayerState | null;
}

export function useLiveSolverMode({
  connected,
  currentPlayerId,
  gameState,
  privateState,
}: UseLiveSolverModeArgs): LiveSolverMode {
  const [enabled, setEnabled] = useState(false);
  const [result, setResult] = useState<LiveSolverResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const latestRequestIdRef = useRef<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const currentRequestKeyRef = useRef<string | null>(null);
  const searchAnchorRef = useRef<string | null>(null);

  const toggle = useCallback(() => setEnabled(v => !v), []);
  useLiveSolverKeybind(toggle);

  const requestNow = useCallback(() => {
    const snapshot = privateState?.liveSolverSnapshot ?? null;
    if (!connected || !gameState || !currentPlayerId || !snapshot) return;
    const requestKey = solverPositionKey(snapshot, currentPlayerId);

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setLastRequestId(requestId);
    if (currentRequestKeyRef.current !== requestKey) setResult(null);
    setSearching(true);
    latestRequestIdRef.current = requestId;
    currentRequestKeyRef.current = requestKey;

    const worker = workerRef.current ?? new Worker(new URL('./liveSolver.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ requestId: string; result: LiveSolverResult; done?: boolean }>) => {
      if (event.data.requestId !== latestRequestIdRef.current) return;
      setResult(event.data.result);
      if (event.data.done) {
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        if (currentRequestKeyRef.current === requestKey) currentRequestKeyRef.current = null;
        setSearching(false);
      }
    };
    worker.onerror = (event) => {
      if (latestRequestIdRef.current !== requestId) return;
      setResult(errorResult(requestId, currentPlayerId, event.message || 'Live solver worker failed.'));
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      if (currentRequestKeyRef.current === requestKey) currentRequestKeyRef.current = null;
      setSearching(false);
    };

    const options: LiveSolverRequestOptions = {
      timeBudgetMs: 300000,
      beamWidth: 1024,
      targetBranches: 160,
      opponentBranches: 1,
      completionWidth: 320,
      maxDecisionPlies: 6000,
      exactTimeBudgetMs: 0,
      exactNodeLimit: 0,
      progressIntervalMs: 1000,
      skipExactSearch: true,
      referenceLineWeight: 32,
    };
    worker.postMessage({
      requestId,
      playerId: currentPlayerId,
      snapshot,
      options,
    });
  }, [connected, currentPlayerId, gameState, privateState]);

  const searchAnchor = (() => {
    const snapshot = privateState?.liveSolverSnapshot ?? null;
    return snapshot ? solverPositionKey(snapshot, currentPlayerId) : null;
  })();

  useEffect(() => {
    if (!enabled || !connected || !gameState || !currentPlayerId) return;
    const snapshot = privateState?.liveSolverSnapshot ?? null;
    if (!snapshot) return;

    const nextAnchor = searchAnchor;
    if (nextAnchor === searchAnchorRef.current) return;
    searchAnchorRef.current = nextAnchor;
    requestNow();
  }, [connected, currentPlayerId, enabled, gameState, privateState, requestNow, searchAnchor]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    currentRequestKeyRef.current = null;
  }, []);

  useEffect(() => {
    if (enabled) return;
    workerRef.current?.terminate();
    workerRef.current = null;
    currentRequestKeyRef.current = null;
    searchAnchorRef.current = null;
    setSearching(false);
  }, [enabled]);

  const pending = enabled && (searching || (lastRequestId !== null && result?.requestId !== lastRequestId));
  return { enabled, toggle, requestNow, pending, result };
}

function errorResult(requestId: string, playerId: string, message: string): LiveSolverResult {
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
