import type { GameState } from '@khora/shared';
import { __liveSolverInternals } from './live-solver';

export function generatedSeedForIteration(baseSeed: number, iteration: number, revisitEvery: number, revisitSeeds: number[]): number {
  if (revisitEvery > 0 && revisitSeeds.length > 0 && iteration % revisitEvery === 0) {
    return revisitSeeds[Math.floor(iteration / revisitEvery - 1) % revisitSeeds.length];
  }
  return baseSeed + iteration - 1;
}

export function referenceScenarioIdentity(state: GameState): string {
  const seats = new Map(state.players.map((player, index) => [player.playerId, `seat-${index}`]));
  function normalize(value: unknown): unknown {
    if (typeof value === 'string') return seats.get(value) ?? value;
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .map(([key, entry]) => [seats.get(key) ?? key, normalize(entry)] as const)
      .sort(([a], [b]) => a.localeCompare(b)));
  }
  return JSON.stringify(normalize(JSON.parse(__liveSolverInternals.stateSignature(state))));
}
