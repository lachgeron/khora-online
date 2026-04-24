/**
 * Solver mode: a persistent, continuously-computing worker that streams the
 * best plan it has found so far for the viewer's position.
 *
 * - Toggle via `toggle()`. When on, the worker spins up and runs forever.
 * - On any game/private state change, the worker is restarted with fresh input.
 *   The current result is kept but flagged `stale` until a fresh plan arrives.
 * - Pauses when the tab is hidden (Page Visibility API) to reclaim CPU.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicGameState, PrivatePlayerState } from '../types';
import type { SolverResult, Plan } from './types';
import { buildSolverInput, canSolveFromPhase } from './snapshot';
// eslint-disable-next-line import/no-unresolved
import SolverWorker from './solver.worker?worker';

const RESTART_DEBOUNCE_MS = 150;

export interface SolverModeState {
  enabled: boolean;
  toggle: () => void;
  result: SolverResult | null;
  stale: boolean;
}

export function useSolverMode(
  gameState: PublicGameState | null,
  privateState: PrivatePlayerState | null,
  currentPlayerId: string,
): SolverModeState {
  const [enabled, setEnabled] = useState(false);
  const [result, setResult] = useState<SolverResult | null>(null);
  const [stale, setStale] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestInputRef = useRef<{ gameState: PublicGameState; privateState: PrivatePlayerState; playerId: string } | null>(null);

  const toggle = useCallback(() => {
    setEnabled((v) => !v);
  }, []);

  // Capture latest inputs for the debounced scheduler.
  useEffect(() => {
    if (gameState && privateState && currentPlayerId) {
      latestInputRef.current = { gameState, privateState, playerId: currentPlayerId };
    } else {
      latestInputRef.current = null;
    }
  }, [gameState, privateState, currentPlayerId]);

  // Spawn / tear down the worker when solver mode toggles.
  useEffect(() => {
    if (!enabled) {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setResult(null);
      setStale(false);
      return;
    }

    const worker = new SolverWorker();
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: 'progress'; plan: Plan }
        | { type: 'unavailable'; reason: string; message: string }
        | { type: 'idle' };
      if (msg.type === 'progress') {
        setResult({ ok: true, plan: msg.plan });
        setStale(false);
      } else if (msg.type === 'unavailable') {
        setResult({
          ok: false,
          reason: (msg.reason as 'PRE_GAME' | 'GAME_OVER' | 'UNKNOWN') ?? 'UNKNOWN',
          message: msg.message,
        });
        setStale(false);
      }
    };

    worker.onerror = (err) => {
      console.error('Solver worker error:', err);
    };

    // Kick off an initial computation if we already have inputs.
    const cur = latestInputRef.current;
    if (cur) {
      const input = buildSolverInput(cur.gameState, cur.privateState, cur.playerId);
      if (input) {
        worker.postMessage({ type: 'start', input, publicState: cur.gameState });
      } else {
        const phaseCheck = canSolveFromPhase(cur.gameState);
        if (!phaseCheck.ok) {
          setResult({
            ok: false,
            reason: phaseCheck.reason ?? 'UNKNOWN',
            message: phaseCheck.message ?? 'Unavailable',
          });
        }
      }
    }

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [enabled]);

  // On state change, debounce a restart.
  useEffect(() => {
    if (!enabled) return;
    const worker = workerRef.current;
    if (!worker) return;
    if (!gameState || !privateState || !currentPlayerId) return;

    // Mark the existing result stale immediately so the UI greys out.
    setStale(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      const input = buildSolverInput(gameState, privateState, currentPlayerId);
      if (!input) {
        const phaseCheck = canSolveFromPhase(gameState);
        if (!phaseCheck.ok) {
          setResult({
            ok: false,
            reason: phaseCheck.reason ?? 'UNKNOWN',
            message: phaseCheck.message ?? 'Unavailable',
          });
          setStale(false);
        }
        return;
      }
      worker.postMessage({ type: 'restart', input, publicState: gameState });
    }, RESTART_DEBOUNCE_MS);
  }, [enabled, gameState, privateState, currentPlayerId]);

  // Pause/resume on tab visibility change to reclaim CPU when hidden.
  useEffect(() => {
    if (!enabled) return;
    const worker = workerRef.current;
    if (!worker) return;

    const handleVisibility = () => {
      if (document.hidden) {
        worker.postMessage({ type: 'pause' });
      } else {
        worker.postMessage({ type: 'resume' });
      }
    };
    // Sync initial state.
    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [enabled]);

  return { enabled, toggle, result, stale };
}
