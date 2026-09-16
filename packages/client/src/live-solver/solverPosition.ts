import type { LiveSolverSnapshot } from '../types';

export const SOLVER_CACHE_VERSION = 2;

export function solverPositionKey(snapshot: LiveSolverSnapshot, playerId: string): string {
  return stableJson({
    ...snapshot,
    cacheVersion: SOLVER_CACHE_VERSION,
    playerId,
    createdAt: undefined,
    updatedAt: undefined,
    gameLog: undefined,
    players: snapshot.players.map(player => ({ ...player, timeBankMs: undefined })),
    pendingDecisions: snapshot.pendingDecisions.map(decision => ({ ...decision, timeoutAt: undefined, usingTimeBank: undefined })),
  });
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => [key, sortValue(entry)]));
}
