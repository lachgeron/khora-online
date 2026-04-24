/**
 * Solver mode: a persistent, continuously-computing worker that streams the
 * best plan it has found so far for the viewer's position.
 *
 * - Toggle via `toggle()`. When on, the worker spins up and runs forever.
 * - On game/private state change, we derive a fresh SolverInput. If it's
 *   equal (structurally) to the one currently being solved, we do nothing —
 *   the worker keeps deepening its existing search. Only a change that
 *   actually affects the SolverInput causes a restart.
 * - When a restart is triggered, the current result is flagged `stale`
 *   (greyed in UI) until a fresh plan arrives.
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
  // The key of the input currently being computed by the worker (or the
  // unavailable-state sentinel if solver can't run). `null` = nothing sent yet.
  const lastSentKeyRef = useRef<string | null>(null);

  const toggle = useCallback(() => {
    setEnabled((v) => !v);
  }, []);

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
      lastSentKeyRef.current = null;
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
      // Ignore messages queued from a prior computation that no longer
      // reflects the current input (e.g. we've since transitioned to an
      // unavailable phase, or cleared state via toggle-off).
      const currentKey = lastSentKeyRef.current;
      if (currentKey === null || currentKey.startsWith('UNAVAILABLE:')) return;
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

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [enabled]);

  // On any state change, compute the derived SolverInput and compare to the
  // last one sent. Only restart the worker if it actually differs.
  useEffect(() => {
    if (!enabled) return;
    const worker = workerRef.current;
    if (!worker) return;

    // Always cancel any pending debounce first — a newer state change
    // supersedes any queued restart.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!gameState || !privateState || !currentPlayerId) return;

    // Handle unavailable phases (pre-game, game over).
    const phaseCheck = canSolveFromPhase(gameState);
    if (!phaseCheck.ok) {
      const key = `UNAVAILABLE:${phaseCheck.reason}:${phaseCheck.message}`;
      if (lastSentKeyRef.current === key) return;
      // Stop any in-flight search so the worker stops burning CPU on a
      // position we no longer care about.
      const hadRunningSearch = lastSentKeyRef.current !== null
        && !lastSentKeyRef.current.startsWith('UNAVAILABLE:');
      lastSentKeyRef.current = key;
      if (hadRunningSearch) worker.postMessage({ type: 'stop' });
      setResult({
        ok: false,
        reason: phaseCheck.reason ?? 'UNKNOWN',
        message: phaseCheck.message ?? 'Unavailable',
      });
      setStale(false);
      return;
    }

    const newInput = buildSolverInput(gameState, privateState, currentPlayerId);
    if (!newInput) return;

    // Structural comparison: if every field the solver consumes is identical,
    // the worker's in-flight search is still answering the same question —
    // don't interrupt it. buildSolverInput constructs fields in a fixed order,
    // so JSON.stringify is a stable equality key.
    const newKey = JSON.stringify(newInput);
    if (newKey === lastSentKeyRef.current) {
      // If we'd previously marked stale (e.g. a flurry of state updates that
      // all net out to the same SolverInput), clear it — the live result is
      // still valid.
      setStale(false);
      return;
    }

    // Genuine input change — mark stale immediately for visual feedback, then
    // debounce the restart so rapid-fire updates don't thrash the worker.
    setStale(true);
    const capturedInput = newInput;
    const capturedPublicState = gameState;
    const capturedKey = newKey;
    const isFirstSend = lastSentKeyRef.current === null;
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      lastSentKeyRef.current = capturedKey;
      worker.postMessage({
        type: isFirstSend ? 'start' : 'restart',
        input: capturedInput,
        publicState: capturedPublicState,
      });
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
    handleVisibility();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [enabled]);

  return { enabled, toggle, result, stale };
}
