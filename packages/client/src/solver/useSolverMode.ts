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
import type { SolverResult, Plan, SolverAction, SolverInput, RoundPlan, SolverObjective, SolverDisplayMode } from './types';
import { buildSolverInput, canSolveFromPhase } from './snapshot';
import { buildDraftPlan, draftPlanKey } from './draft-solver';
// eslint-disable-next-line import/no-unresolved
import SolverWorker from './solver.worker?worker';

const RESTART_DEBOUNCE_MS = 150;
const CONSERVATIVE_SAME_MOVE_REFRESH_THRESHOLD = 1;
const CONSERVATIVE_REORDER_THRESHOLD = 3;
const CONSERVATIVE_SWITCH_THRESHOLD = 7;
const NODE_REFRESH_THRESHOLD = 100_000;

export interface SolverModeState {
  enabled: boolean;
  toggle: () => void;
  godMode: boolean;
  setGodMode: (enabled: boolean) => void;
  objective: SolverObjective;
  setObjective: (objective: SolverObjective) => void;
  displayMode: SolverDisplayMode;
  setDisplayMode: (mode: SolverDisplayMode) => void;
  result: SolverResult | null;
  stale: boolean;
  status: 'stable' | 'rechecking' | 'new-best';
  changeNote: string | null;
}

type ChangeClassification =
  | 'CONSISTENT_PROGRESS'
  | 'CONSISTENT_TRANSITION'
  | 'STALE_CONSTRAINT'
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
  const [displayMode, setDisplayModeState] = useState<SolverDisplayMode>('CONSERVATIVE');
  const [result, setResult] = useState<SolverResult | null>(null);
  const [stale, setStale] = useState(false);
  const [status, setStatus] = useState<'stable' | 'rechecking' | 'new-best'>('stable');
  const [changeNote, setChangeNote] = useState<string | null>(null);
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
  const displayModeRef = useRef<SolverDisplayMode>('CONSERVATIVE');
  useEffect(() => { displayModeRef.current = displayMode; }, [displayMode]);

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
  const setDisplayMode = useCallback((next: SolverDisplayMode) => {
    setDisplayModeState(next);
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
      setStatus('stable');
      setChangeNote(null);
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
          const previousPlan = planFromResult(prev);
          if (!planValidRef.current || !previousPlan) {
            planValidRef.current = true;
            setStatus('new-best');
            setChangeNote(planChangeNote(previousPlan, incoming));
            return { ok: true, plan: incoming };
          }
          if (shouldAcceptPlan(previousPlan, incoming, displayModeRef.current)) {
            setStatus('new-best');
            setChangeNote(planChangeNote(previousPlan, incoming));
            return { ok: true, plan: incoming };
          }
          return prev;
        });
        setStale(false);
        setStatus('stable');
      } else if (msg.type === 'unavailable') {
        setResult({
          ok: false,
          reason: (msg.reason as 'PRE_GAME' | 'GAME_OVER' | 'UNKNOWN') ?? 'UNKNOWN',
          message: msg.message,
        });
        setStale(false);
        setStatus('stable');
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

    const draftPlan = buildDraftPlan(gameState, privateState, currentPlayerId);
    if (draftPlan) {
      const key = `DRAFT:${draftPlanKey(draftPlan)}`;
      if (lastSentKeyRef.current === key) {
        setStale(false);
        return;
      }
      const hadRunningSearch = lastSentKeyRef.current !== null
        && !lastSentKeyRef.current.startsWith('UNAVAILABLE:')
        && !lastSentKeyRef.current.startsWith('DRAFT:');
      lastSentKeyRef.current = key;
      lastInputRef.current = null;
      shiftRoundsRef.current = 0;
      setShiftRoundsState(0);
      planValidRef.current = true;
      if (hadRunningSearch) worker.postMessage({ type: 'stop' });
      setResult({ ok: true, draft: draftPlan });
      setStale(false);
      setStatus('stable');
      setChangeNote(null);
      return;
    }

    // Handle unavailable phases (pre-game, game over).
    const phaseCheck = canSolveFromPhase(gameState);
    if (!phaseCheck.ok) {
      const key = `UNAVAILABLE:${phaseCheck.reason}:${phaseCheck.message}`;
      if (lastSentKeyRef.current === key) return;
      // Stop any in-flight search so the worker stops burning CPU on a
      // position we no longer care about.
      const hadRunningSearch = lastSentKeyRef.current !== null
        && !lastSentKeyRef.current.startsWith('UNAVAILABLE:')
        && !lastSentKeyRef.current.startsWith('DRAFT:');
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
      setStatus('stable');
      setChangeNote(null);
      return;
    }

    const newInput = buildSolverInput(gameState, privateState, currentPlayerId, godMode, objective);
    if (!newInput) return;

    // Structural comparison: if every field the solver consumes is identical,
    // the worker's in-flight search is still answering the same question and
    // there's no need to even re-classify — nothing changed.
    const newKey = solverInputKey(newInput);
    if (newKey === lastSentKeyRef.current) {
      setStale(false);
      return;
    }

    // Classify the change against the most recent input we observed (which
    // may differ from `lastSentKeyRef` if we've absorbed CONSISTENT_* deltas
    // since the last restart).
    const currentPlan = planFromResult(resultRef.current);
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
      setStatus('rechecking');
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
      // Keep it running, but trim already-resolved actions from the visible
      // current-round recommendation so "Do This Now" stays pointed at the
      // next unresolved click.
      setResult(prev => trimCurrentRoundResult(prev, newInput.actionsAlreadyTaken));
      setStale(false);
      setStatus('stable');
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
        setStatus('stable');
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
    if (classification === 'STALE_CONSTRAINT') {
      planValidRef.current = false;
      setShift(0);
      scheduleRestart(0);
      return;
    }
    // OTHER — material game knowledge moved. The old score may have been
    // overvalued, so allow the restarted worker to replace it even if lower.
    planValidRef.current = false;
    setShift(0);
    scheduleRestart(RESTART_DEBOUNCE_MS);
  }, [enabled, gameState, privateState, currentPlayerId, godMode, objective, displayMode, setShift]);

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
    if (!('plan' in result)) return result;
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

  return { enabled, toggle, godMode, setGodMode, objective, setObjective, displayMode, setDisplayMode, result: shiftedResult, stale, status, changeNote };
}

function planFromResult(result: SolverResult | null): Plan | null {
  return result && result.ok && 'plan' in result ? result.plan : null;
}

function trimCurrentRoundResult(result: SolverResult | null, completedActions: SolverAction[]): SolverResult | null {
  if (!result || !result.ok || !('plan' in result) || !result.plan.currentRound) return result;
  const currentRound = trimRoundPlan(result.plan.currentRound, completedActions);
  return { ok: true, plan: { ...result.plan, currentRound } };
}

function trimRoundPlan(round: RoundPlan, completedActions: SolverAction[]): RoundPlan {
  if (completedActions.length === 0) return round;
  const remainingCounts = new Map<SolverAction, number>();
  for (const action of completedActions) {
    remainingCounts.set(action, (remainingCounts.get(action) ?? 0) + 1);
  }

  const actionTypes: SolverAction[] = [];
  for (const action of round.actionTypes) {
    const count = remainingCounts.get(action) ?? 0;
    if (count > 0) {
      remainingCounts.set(action, count - 1);
      continue;
    }
    actionTypes.push(action);
  }

  const moveCounts = new Map<SolverAction, number>();
  for (const action of completedActions) {
    moveCounts.set(action, (moveCounts.get(action) ?? 0) + 1);
  }
  const recommendedMoves = round.recommendedMoves.filter(move => {
    if (move.kind !== 'RESOLVE_ACTION') return true;
    const count = moveCounts.get(move.actionType) ?? 0;
    if (count <= 0) return true;
    moveCounts.set(move.actionType, count - 1);
    return false;
  });

  const lineCounts = new Map<SolverAction, number>();
  for (const action of completedActions) {
    lineCounts.set(action, (lineCounts.get(action) ?? 0) + 1);
  }
  const description = round.description.filter(line => {
    const action = actionForLine(line);
    if (!action) return true;
    const count = lineCounts.get(action) ?? 0;
    if (count <= 0) return true;
    lineCounts.set(action, count - 1);
    return false;
  });

  return { ...round, actionTypes, recommendedMoves, description };
}

function actionForLine(line: string): SolverAction | null {
  if (line.startsWith('Philosophy')) return 'PHILOSOPHY';
  if (line.startsWith('Legislation')) return 'LEGISLATION';
  if (line.startsWith('Culture')) return 'CULTURE';
  if (line.startsWith('Trade')) return 'TRADE';
  if (line.startsWith('Military')) return 'MILITARY';
  if (line.startsWith('Politics')) return 'POLITICS';
  if (line.startsWith('Development')) return 'DEVELOPMENT';
  return null;
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
    if (hardConstraintChanged(prev, next)) return 'STALE_CONSTRAINT';
    if (externalStateChanged(prev, next)) return 'OTHER';
    return 'CONSISTENT_PROGRESS';
  }

  if (next.currentRound === prev.currentRound + 1) {
    // Round advanced by exactly one. Consistent only if every action the
    // player resolved last round matches the plan's recommended bag.
    if (!activeRoundPlan) return 'STALE_CONSTRAINT';
    const prevActs = prev.actionsAlreadyTaken;
    if (prevActs.length !== activeRoundPlan.actionTypes.length) return 'STALE_CONSTRAINT';
    const planned: SolverAction[] = [...activeRoundPlan.actionTypes];
    for (const a of prevActs) {
      const idx = planned.indexOf(a);
      if (idx < 0) return 'STALE_CONSTRAINT';
      planned.splice(idx, 1);
    }
    return 'CONSISTENT_TRANSITION';
  }

  // Round changed by more than one (or backwards) — bail to a full restart.
  return 'STALE_CONSTRAINT';
}

function hardConstraintChanged(prev: SolverInput, next: SolverInput): boolean {
  if (prev.unresolvedAssignedActions.length !== next.unresolvedAssignedActions.length) return true;
  for (let i = 0; i < prev.unresolvedAssignedActions.length; i++) {
    const a = prev.unresolvedAssignedActions[i];
    const b = next.unresolvedAssignedActions[i];
    if (a.action !== b.action || a.dieValue !== b.dieValue || a.citizenCost !== b.citizenCost) return true;
  }
  return false;
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
 * - currentPhase, progressAlreadyDone, slotsConsumedThisRound,
 *   legislationDoneThisRound, pendingAchievementChoices, initialRoundTaxApplied,
 *   and diceRoll: already known to the full-state solver or internal to the
 *   player's turn unless they produce a concrete assigned-action change.
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
  if (prev.objective !== next.objective || prev.godMode !== next.godMode) return true;
  if (solverExternalKey(prev) !== solverExternalKey(next)) return true;
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
  return false;
}

function shouldAcceptPlan(current: Plan, incoming: Plan, mode: SolverDisplayMode): boolean {
  if (incoming.objectiveScore < current.objectiveScore) return false;
  if (mode === 'AGGRESSIVE') return true;

  const currentSig = roundSignature(current.currentRound);
  const incomingSig = roundSignature(incoming.currentRound);
  const improvement = incoming.objectiveScore - current.objectiveScore;
  const currentMove = immediateMoveSignature(current.currentRound);
  const incomingMove = immediateMoveSignature(incoming.currentRound);

  if (currentMove === incomingMove) {
    return improvement >= CONSERVATIVE_SAME_MOVE_REFRESH_THRESHOLD
      || incoming.exploredNodes >= current.exploredNodes + NODE_REFRESH_THRESHOLD;
  }
  if (currentSig === incomingSig) {
    return improvement >= CONSERVATIVE_REORDER_THRESHOLD;
  }
  return improvement >= CONSERVATIVE_SWITCH_THRESHOLD;
}

function roundSignature(round: RoundPlan | null): string {
  return round ? round.actionTypes.join('>') : '';
}

function immediateMoveSignature(round: RoundPlan | null): string {
  if (!round) return '';
  const move = round.recommendedMoves.find(m => m.kind === 'RESOLVE_ACTION')
    ?? round.recommendedMoves.find(m => m.kind === 'ASSIGN_DICE')
    ?? round.recommendedMoves.find(m => m.kind === 'PROGRESS_TRACK')
    ?? round.recommendedMoves[0];
  if (!move) return roundSignature(round);
  if (move.kind === 'RESOLVE_ACTION') {
    return `${move.kind}:${move.actionType}:${JSON.stringify(move.choices)}`;
  }
  if (move.kind === 'ASSIGN_DICE') {
    return `${move.kind}:${move.assignments.map(a => `${a.action}:${a.dieValue}`).join('|')}`;
  }
  if (move.kind === 'PROGRESS_TRACK') {
    return `${move.kind}:${move.tracks.join('|')}`;
  }
  return `${move.kind}:${move.choices.join('|')}`;
}

function planChangeNote(previous: Plan | null, incoming: Plan): string | null {
  if (!previous) return null;
  const previousSig = roundSignature(previous.currentRound);
  const incomingSig = roundSignature(incoming.currentRound);
  if (previousSig !== incomingSig) {
    const gain = Math.round(incoming.objectiveScore - previous.objectiveScore);
    return gain > 0
      ? `Changed because the new current line cleared the sticky threshold by ${gain} point${gain === 1 ? '' : 's'}.`
      : 'Changed because the previous line became stale.';
  }
  if (incoming.objectiveScore > previous.objectiveScore) {
    return 'Future details improved; the immediate move stayed the same.';
  }
  return null;
}

function solverInputKey(input: SolverInput): string {
  return JSON.stringify({
    playerId: input.playerId,
    cityId: input.cityId,
    developmentLevel: input.developmentLevel,
    coins: input.coins,
    philosophyTokens: input.philosophyTokens,
    knowledgeTokens: knowledgeTokenKey(input.knowledgeTokens),
    economyTrack: input.economyTrack,
    cultureTrack: input.cultureTrack,
    militaryTrack: input.militaryTrack,
    taxTrack: input.taxTrack,
    gloryTrack: input.gloryTrack,
    troopTrack: input.troopTrack,
    citizenTrack: input.citizenTrack,
    victoryPoints: input.victoryPoints,
    handCards: cardKey(input.handCards),
    playedCards: cardKey(input.playedCards),
    availableGodModeCards: cardKey(input.availableGodModeCards),
    godMode: input.godMode,
    objective: input.objective,
    currentRound: input.currentRound,
    currentPhase: input.currentPhase,
    diceRoll: input.diceRoll,
    unresolvedAssignedActions: input.unresolvedAssignedActions,
    actionsAlreadyTaken: input.actionsAlreadyTaken,
    slotsConsumedThisRound: input.slotsConsumedThisRound,
    progressAlreadyDone: input.progressAlreadyDone,
    legislationDoneThisRound: input.legislationDoneThisRound,
    availableAchievementIds: input.availableAchievementIds,
    pendingAchievementChoices: input.pendingAchievementChoices,
    initialRoundTaxApplied: input.initialRoundTaxApplied,
    opponents: input.opponents.map(opponentKey),
    boardTokens: boardTokenKey(input.boardTokens),
    external: solverExternalKey(input),
  });
}

function solverExternalKey(input: SolverInput): string {
  const full = input.fullState;
  return JSON.stringify({
    predeterminedDice: input.predeterminedDice,
    currentEvent: full?.currentEvent?.id ?? null,
    eventDeck: full?.eventDeck?.map(e => e.id) ?? [],
    politicsDeck: full?.politicsDeck?.map(c => c.id) ?? [],
    players: full?.players
      ?.filter(p => p.isConnected)
      .map(p => ({
        playerId: p.playerId,
        cityId: p.cityId,
        developmentLevel: p.developmentLevel,
        coins: p.coins,
        philosophyTokens: p.philosophyTokens,
        knowledgeTokens: knowledgeTokenKey(p.knowledgeTokens),
        economyTrack: p.economyTrack,
        cultureTrack: p.cultureTrack,
        militaryTrack: p.militaryTrack,
        taxTrack: p.taxTrack,
        gloryTrack: p.gloryTrack,
        troopTrack: p.troopTrack,
        citizenTrack: p.citizenTrack,
        victoryPoints: p.victoryPoints,
        handCards: cardKey(p.handCards),
        playedCards: cardKey(p.playedCards),
        actionSlots: p.actionSlots?.map(slot => slot
          ? {
              actionType: slot.actionType,
              assignedDie: slot.assignedDie,
              citizenCost: slot.citizenCost,
              resolved: slot.resolved,
            }
          : null),
      })) ?? [],
  });
}

function opponentKey(o: SolverInput['opponents'][number]): unknown {
  return {
    playerId: o.playerId,
    economyTrack: o.economyTrack,
    cultureTrack: o.cultureTrack,
    militaryTrack: o.militaryTrack,
    coins: o.coins,
    philosophyTokens: o.philosophyTokens,
    knowledgeTokens: o.knowledgeTokens ? knowledgeTokenKey(o.knowledgeTokens) : [],
    handCards: o.handCards ? cardKey(o.handCards) : [],
    playedCards: o.playedCards ? cardKey(o.playedCards) : [],
    actionSlots: o.actionSlots?.map(slot => slot
      ? {
          actionType: slot.actionType,
          assignedDie: slot.assignedDie,
          citizenCost: slot.citizenCost,
          resolved: slot.resolved,
        }
      : null),
  };
}

function cardKey(cards: Array<{ id: string }>): string[] {
  return cards.map(c => c.id);
}

function knowledgeTokenKey(tokens: Array<{ id?: string; color: string; tokenType: string }>): string[] {
  return tokens.map(t => `${t.id ?? ''}:${t.color}:${t.tokenType}`).sort();
}

function boardTokenKey(tokens: SolverInput['boardTokens']): string[] {
  return tokens.map(t => [
    t.id,
    t.color,
    t.tokenType,
    t.militaryRequirement,
    t.skullCost,
    t.bonusCoins,
    t.bonusVP,
    t.isPersepolis ? 1 : 0,
  ].join(':'));
}
