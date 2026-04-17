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
  // Base: 1 advancement. Reformists OR Corinth-dev-3 overrides base to 2 (not additive).
  const reformists = hasCard('reformists');
  const corinthDev3 = hasCorinthDev3(s.cityId, s.developmentLevel);
  const baseSlots = (reformists || corinthDev3) ? 2 : 1;

  const results: SolverState[] = [];
  const seenKeys = new Set<string>();

  // Enumerate every multiset of {E, C, M} counts (i, j, k) with total size
  // in [0, baseSlots + maxScrollFunded]. Scrolls spent auto-derived from the
  // extra slots needed beyond baseSlots. Order within a plan is irrelevant:
  // milestone rewards and coin costs depend only on per-track start levels.
  const maxTotal = baseSlots + maxScrollFunded;
  const hasOldGuard = hasCard('old-guard');

  for (let e = 0; e <= maxTotal; e++) {
    for (let c = 0; c <= maxTotal - e; c++) {
      for (let m = 0; m <= maxTotal - e - c; m++) {
        const planSize = e + c + m;
        const scrolls = Math.max(0, planSize - baseSlots);
        if (scrolls > maxScrollFunded) continue;

        const candidate = cloneState(s);
        candidate.philosophyTokens -= scrolls * 2;
        if (candidate.philosophyTokens < 0) continue;

        // Order: apply cheapest track advances first to avoid running out of
        // coins mid-plan when a more expensive track could still be afforded
        // if we'd skipped part of it. Since order doesn't change final track
        // levels or milestones (tracks are independent), we still commit all
        // `e` advances of economy etc., but reject if any single advance
        // runs short.
        const planSpec: Array<{ track: ProgressTrackType; count: number }> = [
          { track: 'ECONOMY', count: e },
          { track: 'CULTURE', count: c },
          { track: 'MILITARY', count: m },
        ];

        let ok = true;
        for (const { track, count } of planSpec) {
          const field: 'economyTrack' | 'cultureTrack' | 'militaryTrack' =
            track === 'ECONOMY' ? 'economyTrack' : track === 'CULTURE' ? 'cultureTrack' : 'militaryTrack';
          for (let i = 0; i < count; i++) {
            const cost = progressCost(track, candidate[field], hasCard, devUnlocked);
            if (!Number.isFinite(cost) || candidate.coins < cost) { ok = false; break; }
            candidate.coins -= cost;
            advanceProgressTrack(candidate, track, 1);
          }
          if (!ok) break;
        }
        if (!ok) continue;

        // Old Guard: +4 VP if no progress done this round.
        if (planSize === 0 && hasOldGuard) candidate.victoryPoints += 4;
        candidate.progressAlreadyDone = true;

        // Dedupe on key resource fields — different scroll paths can collide.
        const key = `${candidate.economyTrack},${candidate.cultureTrack},${candidate.militaryTrack},${candidate.taxTrack},${candidate.gloryTrack},${candidate.coins},${candidate.philosophyTokens},${candidate.citizenTrack},${candidate.victoryPoints}`;
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        results.push(candidate);
      }
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
