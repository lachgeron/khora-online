/**
 * Solver's pure track advancement logic.
 *
 * Mirrors server/resources.ts advanceTrack — applies milestone rewards when
 * crossing thresholds on ECONOMY, CULTURE, MILITARY tracks. Caps at 7.
 */

import type { SolverState } from './types';

interface Milestone { citizens?: number; vp?: number; taxes?: number; glory?: number }

const MAX_CITIZEN_TRACK = 15;
export const MAX_TROOP_TRACK = 15;

const TRACK_MILESTONES: Record<'ECONOMY' | 'CULTURE' | 'MILITARY', Record<number, Milestone>> = {
  ECONOMY: {
    2: { citizens: 3 },
    3: { citizens: 3 },
    4: { vp: 5 },
    5: { citizens: 5 },
    7: { vp: 10 },
  },
  CULTURE: {
    3: { taxes: 1 },
    5: { taxes: 1 },
    6: { taxes: 1 },
    7: { taxes: 2 },
  },
  MILITARY: {
    2: { glory: 1 },
    4: { glory: 1 },
    6: { glory: 1 },
    7: { glory: 2 },
  },
};

/**
 * Mutates state in place (caller should have cloned). Advances a progress track
 * by `amount`, capping at 7, and applies each milestone crossed.
 */
export function advanceProgressTrack(
  s: SolverState,
  track: 'ECONOMY' | 'CULTURE' | 'MILITARY',
  amount: number,
): void {
  const field =
    track === 'ECONOMY' ? 'economyTrack' :
    track === 'CULTURE' ? 'cultureTrack' :
    'militaryTrack';

  const oldLevel = s[field];
  const newLevel = Math.min(7, oldLevel + amount);
  s[field] = newLevel;

  const rewards = TRACK_MILESTONES[track];
  for (let lvl = oldLevel + 1; lvl <= newLevel; lvl++) {
    const reward = rewards[lvl];
    if (!reward) continue;
    if (reward.citizens) s.citizenTrack = Math.min(s.citizenTrack + reward.citizens, MAX_CITIZEN_TRACK);
    if (reward.vp) s.victoryPoints += reward.vp;
    if (reward.taxes) s.taxTrack += reward.taxes;
    if (reward.glory) s.gloryTrack += reward.glory;
  }
}

export function capTroops(s: SolverState): void {
  if (s.troopTrack > MAX_TROOP_TRACK) s.troopTrack = MAX_TROOP_TRACK;
}
