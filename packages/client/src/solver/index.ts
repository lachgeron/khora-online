/**
 * Public API for the optimal-play solver.
 */

export { runSolver } from './solver';
export { buildSolverInput, canSolveFromPhase } from './snapshot';
export type { Plan, RoundPlan, SolverResult, SolverInput, SolverUnavailableReason } from './types';
