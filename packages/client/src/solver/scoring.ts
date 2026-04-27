/**
 * End-game scoring + Tax Phase application.
 */

import type { SolverState, FrozenOpponent } from './types';
import type { PoliticsCard } from '../types';
import { applyOngoingOnTaxPhase, endGameCardVP, hasMaskBit, majorCount, popcount } from './card-data';
import { devEndGameVP } from './city-data';
import { capTroops } from './tracks';

/**
 * Apply Tax Phase effects to state.
 * Tax track gives drachma; ongoing cards fire (Stadion, Power, Public Market).
 */
export function applyTaxPhase(
  s: SolverState,
  opponents: FrozenOpponent[],
  hasCardFn: (id: string) => boolean,
): void {
  // Tax drachma: base = taxTrack level
  s.coins += s.taxTrack;
  applyOngoingOnTaxPhase(s, hasCardFn, opponents);
  // Troops cap at 15 at end of action phase; apply here safely too.
  capTroops(s);
}

/**
 * Compute final VP from the terminal state, including:
 * - Score track VP (already in s.victoryPoints)
 * - Dev end-game VP (Corinth/Thebes/Sparta/Athens dev-4)
 * - Glory × majors
 * - END_GAME card scoring
 */
export function finalizeScore(
  s: SolverState,
  cardIds: string[],
  _allCards: PoliticsCard[],
): {
  total: number;
  breakdown: {
    scoreTrack: number;
    developments: number;
    politicsCards: number;
    gloryTimesMajors: number;
  };
} {
  let politicsVP = 0;
  for (let i = 0; i < cardIds.length; i++) {
    if (!hasMaskBit(s.playedMask, i)) continue;
    politicsVP += endGameCardVP(cardIds[i], s);
  }

  const playedPoliticsCount = popcount(s.playedMask);
  const devVP = devEndGameVP(s.cityId, s.developmentLevel, s, playedPoliticsCount);

  const gloryVP = s.gloryTrack * majorCount(s);

  const total = s.victoryPoints + devVP + politicsVP + gloryVP;
  return {
    total,
    breakdown: {
      scoreTrack: s.victoryPoints,
      developments: devVP,
      politicsCards: politicsVP,
      gloryTimesMajors: gloryVP,
    },
  };
}

/** Admissible upper-bound estimate: optimistic value for remaining rounds. */
export function upperBound(
  s: SolverState,
  cardIds: string[],
  allCards: PoliticsCard[],
  roundsLeft: number,
): number {
  // Optimistic: each remaining round could net ~20 VP via best-case play.
  const perRoundOptimism = 20;
  const final = finalizeScore(s, cardIds, allCards);
  return final.total + perRoundOptimism * roundsLeft;
}
