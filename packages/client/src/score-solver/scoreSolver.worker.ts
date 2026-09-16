import { ScoreSearch, restoreSolverSnapshot } from '@khora/server';
import type { ScoreSolverResult } from '@khora/shared';

const search = new ScoreSearch();
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

self.onmessage = (event: MessageEvent<{ requestId: string; stateJson: string; playerId: string; budgetMs: number }>) => {
  const job = ++generation;
  clearTimeout(timer);
  const { requestId, stateJson, playerId, budgetMs } = event.data;
  const started = performance.now();
  const deadline = started + Math.max(50, Math.min(60_000, budgetMs));
  let lastPublish = -Infinity;
  const fail = (error: unknown) => {
    const result: ScoreSolverResult = { requestId, status: 'ERROR', immediateMove: null, path: [], projectedScore: null,
      completedRollouts: 0, evaluatedMoves: 0, elapsedMs: Math.round(performance.now() - started),
      assumesFutureDraftDraws: false, message: error instanceof Error ? error.message : 'Analysis failed.' };
    self.postMessage(result);
  };
  try {
    search.reset(restoreSolverSnapshot(stateJson), playerId, requestId);
    const work = search.work();
    const tick = () => {
      if (job !== generation) return;
      try {
        const sliceEnd = Math.min(deadline, performance.now() + 12);
        let done = false;
        do { done = Boolean(work.next().done); } while (!done && performance.now() < sliceEnd);
        const now = performance.now();
        const finished = done || now >= deadline;
        if (finished || now - lastPublish >= 150) {
          self.postMessage(search.result(finished ? 'PAUSED' : 'SEARCHING'));
          lastPublish = now;
        }
        if (!finished) timer = setTimeout(tick, 0);
      } catch (error) { fail(error); }
    };
    tick();
  } catch (error) { fail(error); }
};
