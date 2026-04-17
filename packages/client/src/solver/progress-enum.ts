/**
 * Progress phase: enumerate reasonable advancement plans.
 *
 * The Progress phase lets a player advance ECONOMY, CULTURE, or MILITARY by
 * paying drachma. Each track has escalating costs. Bonus tracks (Reformists,
 * Corinth dev-3) allow extras. Philosophy scrolls can fund additional
 * advancements (2 scrolls = 1 extra track).
 */

import type { SolverState, FrozenOpponent } from './types';
import type { ProgressTrackType } from '../types';
import { cloneState } from './card-data';
import {
  economyProgressFree,
  progressDiscount,
} from './card-data';
import { hasCorinthDev3 } from './city-data';
import { advanceProgressTrack } from './tracks';

const ECONOMY_COSTS: Record<number, number> = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 };
const CULTURE_COSTS: Record<number, number> = { 1: 1, 2: 4, 3: 6, 4: 6, 5: 7, 6: 7 };
const MILITARY_COSTS: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9 };

/** Get drachma cost to advance from `fromLevel` to `fromLevel+1` on given track, accounting for discounts. */
export function progressCost(
  track: ProgressTrackType,
  fromLevel: number,
  hasCard: (id: string) => boolean,
  devUnlocked: (id: string) => boolean,
): number {
  if (fromLevel >= 7) return Infinity;
  const baseTable =
    track === 'ECONOMY' ? ECONOMY_COSTS :
    track === 'CULTURE' ? CULTURE_COSTS :
    MILITARY_COSTS;
  const base = baseTable[fromLevel] ?? Infinity;
  if (track === 'ECONOMY' && economyProgressFree(hasCard)) return 0;
  const disc = progressDiscount(hasCard, devUnlocked);
  return Math.max(0, base - disc);
}

/**
 * Enumerate progress-phase plans. Returns a list of (resulting state) candidates.
 *
 * Branching: for each of (base 1 + bonus + scroll-funded) slots, try each track.
 * To keep the branching tractable, we only try a few discrete strategies rather
 * than every combination.
 */
export function enumerateProgressPlans(
  s: SolverState,
  _opponents: FrozenOpponent[],
  hasCard: (id: string) => boolean,
  devUnlocked: (id: string) => boolean,
): SolverState[] {
  if (s.progressAlreadyDone) return [cloneState(s)];

  const maxScrollFunded = Math.floor(s.philosophyTokens / 2);
  const tracks: ProgressTrackType[] = ['ECONOMY', 'CULTURE', 'MILITARY'];
  // Base: 1 advancement. Reformists OR Corinth-dev-3 overrides base to 2 (not additive).
  const reformists = hasCard('reformists');
  const corinthDev3 = hasCorinthDev3(s.cityId, s.developmentLevel);
  const baseSlots = (reformists || corinthDev3) ? 2 : 1;

  const results: SolverState[] = [];

  // We explore N scrolls in {0, 1, 2, 3} capped by maxScrollFunded.
  const scrollOptions = [0, 1, Math.min(2, maxScrollFunded), Math.min(3, maxScrollFunded)]
    .filter((v, i, a) => v <= maxScrollFunded && a.indexOf(v) === i);

  for (const scrolls of scrollOptions) {
    const totalSlots = baseSlots + scrolls;
    // For each single-track focus and "mixed" strategies, enumerate:
    const strategies: ProgressTrackType[][] = [];
    // All-on-one-track strategies
    for (const t of tracks) strategies.push(new Array(totalSlots).fill(t));
    // Split strategies: one on each track
    if (totalSlots >= 2) {
      strategies.push(['ECONOMY', 'CULTURE']);
      strategies.push(['ECONOMY', 'MILITARY']);
      strategies.push(['CULTURE', 'MILITARY']);
    }
    if (totalSlots >= 3) {
      strategies.push(['ECONOMY', 'CULTURE', 'MILITARY']);
    }
    // "Skip progress" strategy for Old Guard
    if (hasCard('old-guard')) strategies.push([]);

    for (const plan of strategies) {
      if (plan.length > totalSlots) continue;
      const candidate = cloneState(s);
      candidate.philosophyTokens -= scrolls * 2;
      if (candidate.philosophyTokens < 0) continue;

      let ok = true;
      for (const t of plan) {
        const field: 'economyTrack' | 'cultureTrack' | 'militaryTrack' =
          t === 'ECONOMY' ? 'economyTrack' : t === 'CULTURE' ? 'cultureTrack' : 'militaryTrack';
        const cost = progressCost(t, candidate[field], hasCard, devUnlocked);
        if (!Number.isFinite(cost) || candidate.coins < cost) { ok = false; break; }
        candidate.coins -= cost;
        advanceProgressTrack(candidate, t, 1);
      }
      if (!ok) continue;
      // Old Guard: +4 VP if no progress done
      if (plan.length === 0 && hasCard('old-guard')) candidate.victoryPoints += 4;
      candidate.progressAlreadyDone = true;
      results.push(candidate);
    }
  }

  if (results.length === 0) {
    // No moves viable — just mark progress as done.
    const nothing = cloneState(s);
    nothing.progressAlreadyDone = true;
    if (hasCard('old-guard')) nothing.victoryPoints += 4;
    results.push(nothing);
  }

  return results;
}
