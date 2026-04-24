/**
 * Solver Web Worker.
 *
 * Owns a long-running beam search. Streams back progressively better plans
 * via postMessage. A `restart` message supersedes any in-flight search — the
 * worker bumps a generation counter, aborts the current search at the next
 * yield boundary, and kicks off a fresh one with the new input.
 */

import { runSolver } from './solver';
import type { SolverInput, SolverResult, Plan } from './types';
import type { PublicGameState } from '../types';

type InboundMessage =
  | { type: 'start'; input: SolverInput; publicState: PublicGameState }
  | { type: 'restart'; input: SolverInput; publicState: PublicGameState }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' };

type OutboundMessage =
  | { type: 'progress'; plan: Plan; generation: number }
  | { type: 'unavailable'; reason: string; message: string; generation: number }
  | { type: 'idle'; generation: number };

let generation = 0;
let paused = false;
let currentInput: SolverInput | null = null;
let currentPublicState: PublicGameState | null = null;
let running = false;

self.onmessage = (e: MessageEvent<InboundMessage>): void => {
  const msg = e.data;
  switch (msg.type) {
    case 'start':
    case 'restart':
      generation++;
      currentInput = msg.input;
      currentPublicState = msg.publicState;
      if (!running) {
        void drive();
      }
      // If already running, the next yield boundary will observe the new
      // generation via shouldAbort() and runOnce() will pick up currentInput.
      break;
    case 'pause':
      paused = true;
      break;
    case 'resume':
      paused = false;
      break;
    case 'stop':
      generation++;
      currentInput = null;
      currentPublicState = null;
      break;
  }
};

async function drive(): Promise<void> {
  running = true;
  try {
    while (currentInput && currentPublicState) {
      const myGen = generation;
      const inputAtStart = currentInput;
      const publicStateAtStart = currentPublicState;

      const result: SolverResult = await runSolver(inputAtStart, publicStateAtStart, {
        shouldAbort: () => myGen !== generation || paused,
        onProgress: (plan) => {
          if (myGen !== generation) return;
          post({ type: 'progress', plan, generation: myGen });
        },
        yieldToHost,
      });

      // If the search aborted because of a new generation, loop and run again.
      if (myGen !== generation) continue;

      // If aborted because paused, wait until resumed then re-run this generation.
      if (paused) {
        await waitWhilePaused(myGen);
        if (myGen !== generation) continue;
        // Kick off a fresh pass for the same generation.
        continue;
      }

      // Search returned normally (only happens if shouldAbort became true but
      // generation unchanged, i.e. paused or some edge). For unavailable phase:
      if (!result.ok) {
        post({ type: 'unavailable', reason: result.reason, message: result.message, generation: myGen });
        // Sleep until the next restart.
        await waitForNewGeneration(myGen);
        continue;
      }

      // If solver returned ok but we weren't aborted, it means runSolver's loop
      // exited naturally. In practice it doesn't — the outer while runs forever
      // unless shouldAbort is true. Treat as idle and wait for next restart.
      post({ type: 'idle', generation: myGen });
      await waitForNewGeneration(myGen);
    }
  } finally {
    running = false;
  }
}

function post(msg: OutboundMessage): void {
  (self as unknown as { postMessage: (m: OutboundMessage) => void }).postMessage(msg);
}

/**
 * Yield to the worker's event loop so queued messages (restart/pause) can run
 * before we continue. `setTimeout(0)` is required here — a microtask yield
 * (Promise.resolve) does not drain the message queue.
 */
function yieldToHost(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitWhilePaused(gen: number): Promise<void> {
  while (paused && gen === generation) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function waitForNewGeneration(gen: number): Promise<void> {
  while (gen === generation) {
    await new Promise((r) => setTimeout(r, 100));
  }
}
