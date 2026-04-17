/**
 * Solver's knowledge of politics-card effects.
 *
 * This mirrors server/card-handlers.ts but expressed as pure transformations
 * on SolverState. We only handle the cards that matter for a solo simulation
 * (no opponent card effects, no events, no draws).
 */

import type { SolverState, FrozenOpponent, SolverAction } from './types';
import { advanceProgressTrack } from './tracks';

/** Clone a SolverState cheaply (shallow copy is fine — knowledge is replaced below if touched). */
export function cloneState(s: SolverState): SolverState {
  return { ...s, knowledge: { ...s.knowledge } };
}

/** How many knowledge tokens of a given color the player has. */
export function knowledgeCount(s: SolverState, color: 'GREEN' | 'BLUE' | 'RED'): number {
  if (color === 'GREEN') return s.knowledge.greenMinor + s.knowledge.greenMajor;
  if (color === 'BLUE') return s.knowledge.blueMinor + s.knowledge.blueMajor;
  return s.knowledge.redMinor + s.knowledge.redMajor;
}

export function totalKnowledge(s: SolverState): number {
  const k = s.knowledge;
  return k.greenMinor + k.blueMinor + k.redMinor + k.greenMajor + k.blueMajor + k.redMajor;
}

export function majorCount(s: SolverState): number {
  return s.knowledge.greenMajor + s.knowledge.blueMajor + s.knowledge.redMajor;
}

export function minorCount(s: SolverState): number {
  return s.knowledge.greenMinor + s.knowledge.blueMinor + s.knowledge.redMinor;
}

// ─── Per-trigger effects (mutate state in place — state is assumed cloned by caller) ───

/** Apply ONGOING card effects that trigger on a specific action. */
export function applyOngoingOnAction(
  s: SolverState,
  action: SolverAction,
  hasCard: (cardId: string) => boolean,
): void {
  if (action === 'CULTURE') {
    if (hasCard('stoa-poikile')) s.coins += 2;
    if (hasCard('persians')) s.troopTrack += 2;
  }
  if (action === 'TRADE') {
    if (hasCard('diolkos')) { s.coins += 1; s.troopTrack += 1; s.victoryPoints += 1; }
    if (hasCard('foreign-supplies')) s.troopTrack += 2;
    if (hasCard('lighthouse')) s.victoryPoints += 3;
  }
  if (action === 'PHILOSOPHY') {
    if (hasCard('founding-the-lyceum')) s.philosophyTokens += 1;
  }
  if (action === 'DEVELOPMENT') {
    if (hasCard('oracle')) s.victoryPoints += 4;
  }
}

/** Trigger when any card is played (excluding the card just played). */
export function applyOngoingOnPlayCard(
  s: SolverState,
  hasCard: (cardId: string) => boolean,
  excludeCardId: string,
): void {
  if (excludeCardId !== 'extraordinary-collection' && hasCard('extraordinary-collection')) {
    s.coins += 2;
  }
}

/** Tax-phase ongoing effects. */
export function applyOngoingOnTaxPhase(
  s: SolverState,
  hasCard: (cardId: string) => boolean,
  opponents: FrozenOpponent[],
): void {
  if (hasCard('stadion')) s.troopTrack += 2;
  if (hasCard('power')) {
    const othersLower = opponents.some(o => o.cultureTrack < s.cultureTrack);
    if (!othersLower) s.victoryPoints += 4;
  }
  if (hasCard('public-market')) {
    const othersHigher = opponents.some(o => o.economyTrack > s.economyTrack);
    if (!othersHigher) s.victoryPoints += 3;
  }
}

// ─── Immediate card effects (when card is played via Politics) ───

/** Apply the immediate effect of a card. */
export function applyImmediateCardEffect(
  s: SolverState,
  cardId: string,
  opponents: FrozenOpponent[],
): void {
  switch (cardId) {
    // ─── Straightforward effects ───
    case 'gifts-from-the-west': s.coins += 3; return;
    case 'archives': s.philosophyTokens += 3; return;
    case 'tunnel-of-eupalinos': s.victoryPoints += 6; return;
    case 'colossus-of-rhodes': s.victoryPoints += 10; return;
    case 'quarry': s.taxTrack += 1; return;
    case 'silver-mining': s.taxTrack += 2; return;
    case 'greek-fire': s.troopTrack += 4; return;
    case 'peripteros': advanceProgressTrack(s, 'CULTURE', 1); return;

    case 'contribution': s.coins += minorCount(s); return;
    case 'mercenary-recruitment': s.troopTrack += s.economyTrack; return;

    case 'rivalry': {
      const allOthersHigher = opponents.length > 0 &&
        opponents.every(o => o.militaryTrack > s.militaryTrack);
      if (allOthersHigher) advanceProgressTrack(s, 'MILITARY', 1);
      return;
    }

    case 'scholarly-welcome': {
      // Solver assumption: "any token from the store". Pick whatever color maximizes
      // future card/dev unlocks. Cheap heuristic: pick the color with least supply.
      const minColor = pickLeastStockedColor(s);
      if (minColor === 'GREEN') s.knowledge.greenMinor += 1;
      else if (minColor === 'BLUE') s.knowledge.blueMinor += 1;
      else s.knowledge.redMinor += 1;
      return;
    }

    // Council / Ostracism / Legislation interactions: skipped per spec.
    case 'council': return;
    case 'ostracism': return;
    default: return;
  }
}

function pickLeastStockedColor(s: SolverState): 'GREEN' | 'BLUE' | 'RED' {
  const g = knowledgeCount(s, 'GREEN');
  const b = knowledgeCount(s, 'BLUE');
  const r = knowledgeCount(s, 'RED');
  if (g <= b && g <= r) return 'GREEN';
  if (b <= r) return 'BLUE';
  return 'RED';
}

// ─── Card cost helpers ───

/** Cost reduction for buying a minor during Trade. */
export function minorBuyCost(hasCard: (id: string) => boolean): number {
  return hasCard('corinthian-columns') ? 3 : 5;
}

/** Bonus progress advancements granted by ongoing cards/devs (Reformists, Corinth dev-3). */
export function bonusProgressAdvancements(
  hasCard: (id: string) => boolean,
  devUnlocked: (id: string) => boolean,
): number {
  let bonus = 0;
  if (hasCard('reformists')) bonus += 1;
  if (devUnlocked('corinth-dev-3')) bonus += 1;
  return bonus;
}

/** Is Economy progress free (Constructing the Mint)? */
export function economyProgressFree(hasCard: (id: string) => boolean): boolean {
  return hasCard('constructing-the-mint');
}

/** Discount per progress advancement (Gradualism + Corinth dev-3). */
export function progressDiscount(
  hasCard: (id: string) => boolean,
  devUnlocked: (id: string) => boolean,
): number {
  let disc = 0;
  if (hasCard('gradualism')) disc += 1;
  if (devUnlocked('corinth-dev-3')) disc += 1;
  return disc;
}

/** Troop discount when exploring (Helepole). */
export function exploreTroopDiscount(hasCard: (id: string) => boolean): number {
  return hasCard('helepole') ? 1 : 0;
}

// ─── End-game card scoring ───

/**
 * Compute VP contribution of an END_GAME card given the final state.
 * Takes card IDs rather than looking them up, so it works with bitmasks.
 */
export function endGameCardVP(cardId: string, s: SolverState): number {
  switch (cardId) {
    case 'bank': return Math.floor(s.coins / 2);
    case 'austerity': {
      // "VP per card in hand". After game ends, handMask bits remaining = hand size.
      const handCount = popcount(s.handMask);
      return handCount * 3;
    }
    case 'proskenion': return s.citizenTrack;
    case 'diversification':
      return 3 * Math.min(s.economyTrack, s.cultureTrack, s.militaryTrack);
    case 'central-government': {
      // "2 VP per card in play, including this one". The card is already in playedMask.
      const playedCount = popcount(s.playedMask);
      return playedCount * 2;
    }
    case 'gold-reserve': return s.economyTrack * 2;
    case 'heavy-taxes': return s.taxTrack * 2;
    case 'hall-of-statues': return totalKnowledge(s);
    default: return 0;
  }
}

export function popcount(n: number): number {
  let c = 0;
  while (n) { n &= (n - 1); c++; }
  return c;
}
