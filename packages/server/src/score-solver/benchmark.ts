import { ScoreSearch } from './search';
import { benchmarkPosition } from './benchmark-position';

const city = process.argv[2] ?? 'athens';
const seed = Number(process.argv[3] ?? 1);
const budget = Number(process.argv[4] ?? 30_000);
const search = new ScoreSearch();
search.reset(benchmarkPosition(city, seed), 'player-1', 'benchmark');
const work = search.work();
const start = performance.now();
let nextReport = 0;
while (performance.now() - start < budget) {
  if (work.next().done) break;
  const elapsed = performance.now() - start;
  if (elapsed >= nextReport && search.result().projectedScore !== null) {
    const result = search.result();
    console.log(JSON.stringify({ city, seed, ms: Math.round(elapsed), score: result.projectedScore,
      trials: result.completedRollouts, moves: result.evaluatedMoves, immediate: result.immediateMove?.instruction }));
    nextReport = elapsed + 5000;
  }
}
const result = search.result('PAUSED');
console.log(JSON.stringify({ city, seed, score: result.projectedScore, trials: result.completedRollouts, moves: result.evaluatedMoves,
  path: result.path.filter(m => m.playerId === 'player-1').map(m => `R${m.round}: ${m.instruction}`) }, null, 2));
