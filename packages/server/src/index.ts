/**
 * @khora/server — Game logic, state machine, phase managers,
 * action resolvers, scoring engine, and networking for
 * Khora: Rise of an Empire.
 */
// Browser-safe analysis entry points; do not export the HTTP server here.
export { ScoreSearch } from './score-solver/search';
export { restoreSolverSnapshot } from './score-solver/simulation';
