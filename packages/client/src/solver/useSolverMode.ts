/**
 * Solver mode: a persistent, continuously-computing worker that streams the
 * best plan it has found so far for the viewer's position.
 *
 * Restart strategy
 * ────────────────
 * The worker's search is anchored to the snapshot it was started with. We try
 * very hard NOT to restart it when the game state evolves in a way the search
 * already accounted for — every restart throws away accumulated work and the
 * player sees the recommendation regress visually before it improves again.
 *
 * Each state delta is classified as one of:
 *   - CONSISTENT_PROGRESS   — same round, the player resolved another action
 *                              and that action is in the plan's recommended bag.
 *                              Worker keeps running. We do not restart.
 *   - CONSISTENT_TRANSITION — round advanced by one, and every action the
 *                              player resolved last round was in the plan's
 *                              recommended bag. Worker keeps running; we
 *                              "shift" the displayed plan so its
 *                              `futureRounds[0]` becomes the new currentRound.
 *   - DIVERGENT_ACTION      — player resolved an action this round that the
 *                              plan didn't recommend. Existing plan is invalid
 *                              for the new game state — restart now (no
 *                              debounce) and let the new search overwrite.
 *   - OTHER                  — anything else (opponent state moved, board
 *                              token explored, etc). Restart with the normal
 *                              debounce, but the displayed plan is NOT marked
 *                              invalid — the new worker only replaces it if
 *                              it produces something at least as good.
 *
 * Best-plan persistence
 * ─────────────────────
 * The displayed plan is the highest-VP plan seen so far in the current "valid"
 * window. A new plan from the worker only replaces the displayed plan when:
 *   (a) the displayed plan was invalidated (DIVERGENT_ACTION), or
 *   (b) there is no currently-displayed plan, or
 *   (c) the new plan's `projectedFinalVP` is >= the displayed plan's.
 * This means a freshly-restarted worker that has only had a few ms to think
 * does not visually regress the recommendation.
 *
 * Pauses when the tab is hidden (Page Visibility API) to reclaim CPU.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicGameState, PrivatePlayerState } from '../types';
import type { SolverResult, Plan, SolverAction, SolverInput, RoundPlan, SolverObjective } from './types';
import { buildSolverInput, canSolveFromPhase } from './snapshot';
// eslint-disable-next-line import/no-unresolved
import SolverWorker from './solver.worker?worker';

const RESTART_DEBOUNCE_MS = 150;

export interface SolverModeState {
  enabled: boolean;
  toggle: () => void;
  godMode: boolean;
  setGodMode: (enabled: boolean) => void;
  objective: SolverObjective;
  setObjective: (objective: SolverObjective) => void;
  result: SolverResult | null;
  stale: boolean;
}

type ChangeClassification =
  | 'CONSISTENT_PROGRESS'
  | 'CONSISTENT_TRANSITION'
  | 'DIVERGENT_ACTION'
  | 'OTHER';

export function useSolverMode(
  gameState: PublicGameState | null,
  privateState: PrivatePlayerState | null,
  currentPlayerId: string,
): SolverModeState {
  const [enabled, setEnabled] = useState(false);
  const [godMode, setGodModeState] = useState(false);
  const [objective, setObjectiveState] = useState<SolverObjective>('MAX_VP');
  const [result, setResult] = useState<SolverResult | null>(null);
  const [stale, setStale] = useState(false);
  // Number of complete rounds the live game has progressed past the snapshot
  // the worker is currently computing for. When > 0, the displayed plan's
  // currentRound is taken from `plan.futureRounds[shiftRounds - 1]` instead
  // of `plan.currentRound`. Reset to 0 on every restart.
  const [shiftRounds, setShiftRoundsState] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The key of the input currently being computed by the worker (or the
  // unavailable-state sentinel if solver can't run). `null` = nothing sent yet.
  const lastSentKeyRef = useRef<string | null>(null);
  // Snapshot of the most recent SolverInput we observed. Used to classify
  // each subsequent state change against the previous one.
  const lastInputRef = useRef<SolverInput | null>(null);
  // Mirror of the `result` state, kept current for synchronous reads inside
  // the state-change effect (where the latest setResult may not yet be
  // reflected in the closure).
  const resultRef = useRef<SolverResult | null>(null);
  useEffect(() => { resultRef.current = result; }, [result]);
  // Mirror of `shiftRounds` so the state-change effect can read/update without
  // re-subscribing. Always kept in lockstep with the state.
  const shiftRoundsRef = useRef(0);
  // True when the displayed plan is still applicable to the live game state.
  // False after a DIVERGENT_ACTION (player picked something the plan didn't
  // recommend) — in that case the next worker output overwrites unconditionally.
  const planValidRef = useRef(true);

  const setShift = useCallback((n: number) => {
    shiftRoundsRef.current = n;
    setShiftRoundsState(n);
  }, []);

  const toggle = useCallback(() => {
    setEnabled((v) => !v);
  }, []);

  const setGodMode = useCallback((next: boolean) => {
    setGodModeState(next);
  }, []);

  const setObjective = useCallback((next: SolverObjective) => {
    setObjectiveState(next);
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
      lastInputRef.current = null;
      shiftRoundsRef.current = 0;
      setShiftRoundsState(0);
      planValidRef.current = true;
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
        const incoming = msg.plan;
        setResult((prev) => {
          // If the displayed plan was invalidated (player diverged) or doesn't
          // exist yet, accept the incoming plan unconditionally. Otherwise
          // only replace when the incoming plan is at least as good — this
          // avoids a visible recommendation regression while a freshly
          // restarted worker is still warming up.
          if (!planValidRef.current || !prev || !prev.ok) {
            planValidRef.current = true;
            return { ok: true, plan: incoming };
          }
          if (incoming.objectiveScore >= prev.plan.objectiveScore) {
            return { ok: true, plan: incoming };
          }
          return prev;
        });
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

  // On any state change, derive a SolverInput, classify the delta against the
  // previous input, and decide whether to restart the worker.
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
      lastInputRef.current = null;
      shiftRoundsRef.current = 0;
      setShiftRoundsState(0);
      planValidRef.current = true;
      if (hadRunningSearch) worker.postMessage({ type: 'stop' });
      setResult({
        ok: false,
        reason: phaseCheck.reason ?? 'UNKNOWN',
        message: phaseCheck.message ?? 'Unavailable',
      });
      setStale(false);
      return;
    }

    const newInput = buildSolverInput(gameState, privateState, currentPlayerId, godMode, objective);
    if (!newInput) return;

    // Structural comparison: if every field the solver consumes is identical,
    // the worker's in-flight search is still answering the same question and
    // there's no need to even re-classify — nothing changed.
    const newKey = JSON.stringify(newInput);
    if (newKey === lastSentKeyRef.current) {
      setStale(false);
      return;
    }

    // Classify the change against the most recent input we observed (which
    // may differ from `lastSentKeyRef` if we've absorbed CONSISTENT_* deltas
    // since the last restart).
    const currentPlan = resultRef.current?.ok ? resultRef.current.plan : null;
    const classification = classifyChange(
      lastInputRef.current,
      newInput,
      currentPlan,
      shiftRoundsRef.current,
    );
    lastInputRef.current = newInput;

    // Helper for the restart path — captures local closure values and queues
    // the postMessage with the appropriate delay.
    const scheduleRestart = (delay: number) => {
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
      }, delay);
    };

    if (classification === 'CONSISTENT_PROGRESS') {
      // Worker's in-flight search already accounts for this action sequence.
      // Keep it running; no restart, no shift change.
      setStale(false);
      return;
    }
    if (classification === 'CONSISTENT_TRANSITION') {
      // Round advanced cleanly. Don't restart — instead bump the shift so
      // the displayed plan slides forward to the new "current" round.
      // If the plan doesn't extend that far, fall through to a restart.
      const nextShift = shiftRoundsRef.current + 1;
      const planLength = currentPlan ? currentPlan.futureRounds.length : -1;
      if (currentPlan && nextShift <= planLength) {
        setShift(nextShift);
        setStale(false);
        return;
      }
      // Plan exhausted — must restart.
      setShift(0);
      scheduleRestart(RESTART_DEBOUNCE_MS);
      return;
    }
    if (classification === 'DIVERGENT_ACTION') {
      // Player chose an action the plan didn't recommend. Invalidate the
      // displayed plan so the next worker output replaces it unconditionally,
      // and restart immediately to compute the new optimal line.
      planValidRef.current = false;
      setShift(0);
      scheduleRestart(0);
      return;
    }
    // OTHER — opponent moved, board changed, achievement consumed, etc.
    // The displayed plan is still likely useful, so we leave planValidRef
    // alone (next worker output only replaces the plan if it's better).
    setShift(0);
    scheduleRestart(RESTART_DEBOUNCE_MS);
  }, [enabled, gameState, privateState, currentPlayerId, godMode, objective, setShift]);

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

  // Apply the round shift when surfacing the result. Keeps internal storage
  // (the worker's anchor plan) separate from the user-visible "current round"
  // pointer, so we can absorb consistent transitions without restarting.
  const shiftedResult = useMemo<SolverResult | null>(() => {
    if (!result || !result.ok) return result;
    if (shiftRounds === 0) return result;
    const plan = result.plan;
    if (shiftRounds > plan.futureRounds.length) {
      // Should not happen — CONSISTENT_TRANSITION refuses to shift past the
      // plan's end and falls back to a restart. Defensive: surface as-is.
      return result;
    }
    const newCurrent: RoundPlan | null = shiftRounds === 0
      ? plan.currentRound
      : plan.futureRounds[shiftRounds - 1] ?? null;
    return {
      ok: true,
      plan: {
        ...plan,
        currentRound: newCurrent,
        futureRounds: plan.futureRounds.slice(shiftRounds),
      },
    };
  }, [result, shiftRounds]);

  return { enabled, toggle, godMode, setGodMode, objective, setObjective, result: shiftedResult, stale };
}

/**
 * Classify a state change against the previous snapshot and the active plan.
 *
 * Returns the strongest claim the data supports — see file header for the
 * meaning of each label and the policy attached to it.
 */
function classifyChange(
  prev: SolverInput | null,
  next: SolverInput,
  plan: Plan | null,
  shift: number,
): ChangeClassification {
  if (!prev) return 'OTHER';

  // The plan's "current round" (from the player's POV) is whichever RoundPlan
  // we'd surface given the current shift. That's what consistency must be
  // measured against — not the worker's anchor `currentRound`, which may be
  // several rounds behind the live game.
  const activeRoundPlan: RoundPlan | null = plan
    ? (shift === 0 ? plan.currentRound : (plan.futureRounds[shift - 1] ?? null))
    : null;

  if (next.currentRound === prev.currentRound) {
    // Same round — three sub-cases:
    //   (a) A new action was resolved → must match the plan's recommended bag.
    //   (b) No action delta, but external (opponent/board/achievement) state
    //       moved → restart (worker can't predict those).
    //   (c) No action delta and only player/phase-internal fields moved →
    //       benign intra-round phase transition; keep the worker running.
    const prevActs = prev.actionsAlreadyTaken;
    const newActs = next.actionsAlreadyTaken;
    if (newActs.length > prevActs.length) {
      if (!activeRoundPlan) return 'OTHER';
      // Multiset containment: every resolved action so far must be in the
      // plan's recommended bag (the plan returns actions as an unordered
      // multiset).
      const planned: SolverAction[] = [...activeRoundPlan.actionTypes];
      for (const a of newActs) {
        const idx = planned.indexOf(a);
        if (idx < 0) return 'DIVERGENT_ACTION';
        planned.splice(idx, 1);
      }
      return 'CONSISTENT_PROGRESS';
    }
    if (newActs.length < prevActs.length) {
      // Action count decreased — shouldn't happen mid-round. Treat as OTHER.
      return 'OTHER';
    }
    // Same action set. Restart only if something the worker can't predict moved.
    if (externalStateChanged(prev, next)) return 'OTHER';
    return 'CONSISTENT_PROGRESS';
  }

  if (next.currentRound === prev.currentRound + 1) {
    // Round advanced by exactly one. Consistent only if every action the
    // player resolved last round matches the plan's recommended bag.
    if (!activeRoundPlan) return 'OTHER';
    const prevActs = prev.actionsAlreadyTaken;
    if (prevActs.length !== activeRoundPlan.actionTypes.length) return 'OTHER';
    const planned: SolverAction[] = [...activeRoundPlan.actionTypes];
    for (const a of prevActs) {
      const idx = planned.indexOf(a);
      if (idx < 0) return 'OTHER';
      planned.splice(idx, 1);
    }
    return 'CONSISTENT_TRANSITION';
  }

  // Round changed by more than one (or backwards) — bail to a full restart.
  return 'OTHER';
}

/**
 * True iff a field outside the player's own state has changed between two
 * snapshots. Used to distinguish "opponent / board state moved, worker's plan
 * may now be inaccurate" from "phase advanced inside our own turn, plan
 * already accounted for it".
 *
 * What we deliberately DO NOT compare here:
 * - Player tracks, coins, knowledge, philosophy, VP, citizens, troops,
 *   developmentLevel, played/hand cards: these all evolve as the player
 *   progresses through their own round, and the worker's plan already models
 *   them as part of the same simulated round.
 * - progressAlreadyDone, slotsConsumedThisRound, legislationDoneThisRound,
 *   pendingAchievementChoices, initialRoundTaxApplied: phase markers internal
 *   to the player's turn.
 *
 * What we DO compare:
 * - opponents[] (any field): opponents take turns between ours, and Public
 *   Market / Power scoring depends on their tracks crossing thresholds.
 * - boardTokens[]: shrinks when any player explores; affects what the
 *   solver considers as candidate Military targets.
 * - availableAchievementIds[]: shrinks when any player claims; affects which
 *   achievement claims are still on the table for us this round.
 */
function externalStateChanged(prev: SolverInput, next: SolverInput): boolean {
  if (prev.opponents.length !== next.opponents.length) return true;
  for (let i = 0; i < prev.opponents.length; i++) {
    const a = prev.opponents[i];
    const b = next.opponents[i];
    if (a.economyTrack !== b.economyTrack
      || a.cultureTrack !== b.cultureTrack
      || a.militaryTrack !== b.militaryTrack) return true;
  }
  if (prev.boardTokens.length !== next.boardTokens.length) return true;
  for (let i = 0; i < prev.boardTokens.length; i++) {
    if (prev.boardTokens[i].id !== next.boardTokens[i].id) return true;
  }
  if (prev.availableAchievementIds.length !== next.availableAchievementIds.length) return true;
  for (let i = 0; i < prev.availableAchievementIds.length; i++) {
    if (prev.availableAchievementIds[i] !== next.availableAchievementIds[i]) return true;
  }
  if ((prev.diceRoll ?? []).join(',') !== (next.diceRoll ?? []).join(',')) return true;
  if (prev.unresolvedAssignedActions.length !== next.unresolvedAssignedActions.length) return true;
  for (let i = 0; i < prev.unresolvedAssignedActions.length; i++) {
    const a = prev.unresolvedAssignedActions[i];
    const b = next.unresolvedAssignedActions[i];
    if (a.action !== b.action || a.dieValue !== b.dieValue || a.citizenCost !== b.citizenCost) return true;
  }
  return false;
}
