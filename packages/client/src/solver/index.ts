/**
 * Public API for the optimal-play solver.
 */

export { runSolver } from './solver';
export { buildSolverInput, canSolveFromPhase } from './snapshot';
export { useSolverMode } from './useSolverMode';
export type { Plan, RoundPlan, SolverResult, SolverInput, SolverUnavailableReason } from './types';
