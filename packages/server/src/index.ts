/**
 * @khora/server — Game logic, state machine, phase managers,
 * action resolvers, scoring engine, and networking for
 * Khora: Rise of an Empire.
 */
export { buildReferenceLinePreview, runLiveSolver, validateLiveSolverLine, createLiveSolverSearchSession } from './live-solver';
export { buildLiveSolverSnapshot, gameStateFromLiveSolverSnapshot } from './live-solver-snapshot';
