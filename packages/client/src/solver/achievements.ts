/**
 * Achievement evaluation for the solver.
 *
 * The 5 default achievements (defined server-side in `integration.ts`) are
 * mirrored here as solver-state predicates. Unknown achievement IDs are
 * silently ignored — the solver simply won't count them.
 *
 * Remaining achievement IDs are carried in SolverState so future simulated
 * rounds can claim rewards that are still available along that line.
 */

import type { SolverState } from './types';
import { popcount } from './card-data';

export interface AchievementDef {
  id: string;
  name: string;
  qualifies: (s: SolverState) => boolean;
}

const REGISTRY: Record<string, AchievementDef> = {
  'ach-10vp': {
    id: 'ach-10vp',
    name: '10 VP',
    qualifies: (s) => s.victoryPoints >= 10,
  },
  'ach-12citizens': {
    id: 'ach-12citizens',
    name: '12 Citizens',
    qualifies: (s) => s.citizenTrack >= 12,
  },
  'ach-4economy': {
    id: 'ach-4economy',
    name: '4 Economy',
    qualifies: (s) => s.economyTrack >= 4,
  },
  'ach-3cards': {
    id: 'ach-3cards',
    name: '3 Cards Played',
    qualifies: (s) => popcount(s.playedMask) >= 3,
  },
  'ach-6troops': {
    id: 'ach-6troops',
    name: '6 Troops',
    qualifies: (s) => s.troopTrack >= 6,
  },
};

/** Look up an achievement definition by id; null if unknown to the solver. */
export function getAchievement(id: string): AchievementDef | null {
  return REGISTRY[id] ?? null;
}
