import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveSolverRequestOptions, LiveSolverResult, PrivatePlayerState, PublicGameState } from '../types';
import { useLiveSolverKeybind } from './useLiveSolverKeybind';

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPositionKeyRef = useRef<string | null>(null);
  const latestRequestIdRef = useRef<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const toggle = useCallback(() => setEnabled(v => !v), []);
  useLiveSolverKeybind(toggle);

  const requestNow = useCallback(() => {
    const snapshot = privateState?.liveSolverSnapshot ?? null;
    if (!connected || !gameState || !currentPlayerId || !snapshot) return;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setLastRequestId(requestId);
    setSearching(true);
    latestRequestIdRef.current = requestId;

    workerRef.current?.terminate();
    const worker = new Worker(new URL('./liveSolver.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<{ requestId: string; result: LiveSolverResult; done?: boolean }>) => {
      if (event.data.requestId !== latestRequestIdRef.current) return;
      setResult(event.data.result);
      if (event.data.done) {
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        setSearching(false);
      }
    };
    worker.onerror = (event) => {
      if (latestRequestIdRef.current !== requestId) return;
      setResult(errorResult(requestId, currentPlayerId, event.message || 'Live solver worker failed.'));
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
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
    };
    worker.postMessage({
      requestId,
      playerId: currentPlayerId,
      snapshot,
      options,
    });
  }, [connected, currentPlayerId, gameState, privateState]);

  const positionKey = useMemo(() => {
    if (!gameState) return '';
    const myDecision = gameState.pendingDecisions.find(d =>
      d.playerId === currentPlayerId && d.decisionType !== 'PHASE_DISPLAY');
    return JSON.stringify({
      round: gameState.roundNumber,
      myDecision: myDecision?.decisionType ?? null,
      players: gameState.players.map(p => ({
        id: p.playerId,
        vp: p.victoryPoints,
        coins: p.coins,
        scrolls: p.philosophyTokens,
        tracks: [p.economyTrack, p.cultureTrack, p.militaryTrack, p.taxTrack, p.gloryTrack, p.troopTrack, p.citizenTrack],
        hand: p.handCardCount,
        played: p.playedCardCount,
        tokens: p.knowledgeTokens.map(t => t.id).join(','),
        slots: p.actionSlots.map(s => `${s.actionType}:${s.resolved ? 1 : 0}`).join(','),
        flagged: p.hasFlagged,
      })),
      event: gameState.currentEvent?.id ?? null,
      achievements: gameState.availableAchievements.map(a => a.id),
      board: gameState.centralBoardTokens.filter(t => !t.explored).map(t => t.id),
    });
  }, [currentPlayerId, gameState]);

  useEffect(() => {
    if (!enabled || !connected || !gameState || !currentPlayerId) return;
    if (positionKey === lastPositionKeyRef.current) return;
    lastPositionKeyRef.current = positionKey;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      requestNow();
    }, 180);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [connected, currentPlayerId, enabled, gameState, positionKey, requestNow]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  useEffect(() => {
    if (enabled) return;
    workerRef.current?.terminate();
    workerRef.current = null;
    lastPositionKeyRef.current = null;
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
