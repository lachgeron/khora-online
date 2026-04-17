/**
 * Solver's knowledge of city-development effects.
 *
 * Each city has 4 developments that unlock sequentially. We model their
 * immediate effects, ongoing effects per action, and end-game scoring.
 */

import type { SolverState, FrozenOpponent, SolverAction, KnowledgeCounts } from './types';
import { advanceProgressTrack } from './tracks';
import { totalKnowledge, knowledgeCount } from './card-data';

/** Drachma cost required to unlock dev N of the given city. */
export function devDrachmaCost(cityId: string, level: number): number {
  const map = DEV_COSTS[cityId];
  if (!map) return 0;
  return map[level] ?? 0;
}

const DEV_COSTS: Record<string, Record<number, number>> = {
  corinth: { 1: 0, 2: 1, 3: 2, 4: 3 },
  thebes:  { 1: 0, 2: 0, 3: 0, 4: 2 },
  miletus: { 1: 0, 2: 1, 3: 2, 4: 4 },
  sparta:  { 1: 0, 2: 2, 3: 2, 4: 4 },
  olympia: { 1: 0, 2: 0, 3: 2, 4: 3 },
  argos:   { 1: 0, 2: 0, 3: 0, 4: 2 },
  athens:  { 1: 0, 2: 0, 3: 1, 4: 2 },
};

/** Knowledge-token requirements for each city dev. */
export function devKnowledgeRequirement(
  cityId: string,
  level: number,
): { green: number; blue: number; red: number } {
  const map = DEV_REQUIREMENTS[cityId];
  if (!map) return { green: 0, blue: 0, red: 0 };
  return map[level] ?? { green: 0, blue: 0, red: 0 };
}

const DEV_REQUIREMENTS: Record<string, Record<number, { green: number; blue: number; red: number }>> = {
  corinth: {
    1: { green: 0, blue: 0, red: 0 },
    2: { green: 0, blue: 0, red: 1 },
    3: { green: 1, blue: 1, red: 2 },
    4: { green: 2, blue: 2, red: 0 },
  },
  thebes: {
    1: { green: 0, blue: 0, red: 0 },
    2: { green: 1, blue: 1, red: 0 },
    3: { green: 1, blue: 2, red: 1 },
    4: { green: 2, blue: 2, red: 0 },
  },
  miletus: {
    1: { green: 0, blue: 0, red: 0 },
    2: { green: 0, blue: 0, red: 1 },
    3: { green: 1, blue: 0, red: 2 },
    4: { green: 2, blue: 0, red: 3 },
  },
  sparta: {
    1: { green: 0, blue: 0, red: 0 },
    2: { green: 0, blue: 2, red: 0 },
    3: { green: 1, blue: 3, red: 1 },
    4: { green: 2, blue: 3, red: 2 },
  },
  olympia: {
    1: { green: 0, blue: 0, red: 0 },
    2: { green: 1, blue: 0, red: 0 },
    3: { green: 2, blue: 0, red: 1 },
    4: { green: 3, blue: 1, red: 2 },
  },
  argos: {
    1: { green: 0, blue: 0, red: 0 },
    2: { green: 0, blue: 2, red: 0 },
    3: { green: 0, blue: 2, red: 1 },
    4: { green: 2, blue: 3, red: 1 },
  },
  athens: {
    1: { green: 0, blue: 0, red: 0 },
    2: { green: 1, blue: 0, red: 1 },
    3: { green: 0, blue: 2, red: 0 },
    4: { green: 2, blue: 2, red: 2 },
  },
};

/** Apply the immediate effect of unlocking dev `level` for the city. */
export function applyDevImmediateEffect(
  s: SolverState,
  cityId: string,
  level: number,
): void {
  // corinth
  if (cityId === 'corinth' && level === 1) { s.coins += 4; return; }
  if (cityId === 'corinth' && level === 2) {
    s.taxTrack += totalKnowledge(s);
    return;
  }
  // thebes
  if (cityId === 'thebes' && level === 1) { advanceProgressTrack(s, 'MILITARY', 1); return; }
  if (cityId === 'thebes' && level === 3) { /* ONGOING: explore twice on MILITARY action */ return; }
  // miletus
  if (cityId === 'miletus' && level === 1) { advanceProgressTrack(s, 'ECONOMY', 1); return; }
  if (cityId === 'miletus' && level === 2) {
    // Pick any 2 tracks to move up one each (free). Heuristic: pick the two lowest progress tracks.
    const tracks: Array<{ t: 'ECONOMY' | 'CULTURE' | 'MILITARY'; lvl: number }> = [
      { t: 'ECONOMY', lvl: s.economyTrack },
      { t: 'CULTURE', lvl: s.cultureTrack },
      { t: 'MILITARY', lvl: s.militaryTrack },
    ];
    tracks.sort((a, b) => a.lvl - b.lvl);
    advanceProgressTrack(s, tracks[0].t, 1);
    advanceProgressTrack(s, tracks[1].t, 1);
    return;
  }
  if (cityId === 'miletus' && level === 4) { s.victoryPoints += 15; return; }
  // sparta
  if (cityId === 'sparta' && level === 3) {
    // Take 2 military actions — simplified: grant ~8 troops (flexible) + ~2 tokens of choice.
    // For solver simplicity, model as troops/tokens grant, since exploration is a separate action type.
    s.troopTrack += 6;
    s.knowledge.greenMinor += 1;
    s.knowledge.blueMinor += 1;
    return;
  }
  // olympia
  if (cityId === 'olympia' && level === 1) { s.taxTrack += 1; return; }
  if (cityId === 'olympia' && level === 3) { advanceProgressTrack(s, 'CULTURE', 2); return; }
  if (cityId === 'olympia' && level === 4) {
    // Take 3 culture actions — model as +6 coins (Stoa) and philosophy via ongoing? Simplified:
    // 3 culture action triggers. Culture base gives coins (track level+2-ish) and sometimes ONGOING bonuses.
    // Solver-level heuristic: approximate as 3× coin income at culture-level, plus ongoing triggers.
    for (let i = 0; i < 3; i++) applyCultureActionEconomics(s);
    return;
  }
  // argos
  if (cityId === 'argos' && level === 1) { s.troopTrack += 2; return; }
  if (cityId === 'argos' && level === 2) {
    // 4-way choice: 2 troops / 3 drachma / 4 VP / 5 citizens. Heuristic: pick highest-value.
    // 4 VP is typically best; pick VP.
    s.victoryPoints += 4;
    return;
  }
  if (cityId === 'argos' && level === 3) { advanceProgressTrack(s, 'MILITARY', 1); return; }
  if (cityId === 'argos' && level === 4) { s.gloryTrack += 2; return; }
  // athens
  if (cityId === 'athens' && level === 1) { s.philosophyTokens += 3; return; }
}

/** Helper for Olympia dev-4: approximate Culture action economics. */
function applyCultureActionEconomics(s: SolverState): void {
  // Base culture action income: at culture track level L, gain L drachma (approximation).
  s.coins += s.cultureTrack;
}

/**
 * Apply ONGOING dev effects triggered by an action.
 */
export function applyDevOngoingOnAction(
  s: SolverState,
  action: SolverAction,
  cityId: string,
  devLevel: number,
): void {
  // Miletus dev-3: +3 VP on trade
  if (cityId === 'miletus' && devLevel >= 3 && action === 'TRADE') {
    s.victoryPoints += 3;
  }
  // Olympia dev-2: +1 troop +1 scroll on culture
  if (cityId === 'olympia' && devLevel >= 2 && action === 'CULTURE') {
    s.troopTrack += 1;
    s.philosophyTokens += 1;
  }
  // Sparta dev-2: +1 taxes on military
  if (cityId === 'sparta' && devLevel >= 2 && action === 'MILITARY') {
    s.taxTrack += 1;
  }
}

/**
 * Apply ONGOING dev effects triggered by playing a card.
 */
export function applyDevOngoingOnPlayCard(
  s: SolverState,
  cityId: string,
  devLevel: number,
): void {
  if (cityId === 'athens' && devLevel >= 2) {
    s.coins += 2;
    s.victoryPoints += 3;
  }
  if (cityId === 'athens' && devLevel >= 3) {
    s.troopTrack += 2;
  }
}

/** Thebes dev-2: once per round, lose 1 glory → gain 2 drachma + 4 VP. */
export function maybeApplyThebesDev2(
  s: SolverState,
  cityId: string,
  devLevel: number,
): void {
  if (cityId === 'thebes' && devLevel >= 2 && s.gloryTrack >= 1) {
    s.gloryTrack -= 1;
    s.coins += 2;
    s.victoryPoints += 4;
  }
}

/** Thebes dev-3: explore twice on Military action. */
export function hasThebesDev3(cityId: string, devLevel: number): boolean {
  return cityId === 'thebes' && devLevel >= 3;
}

/** End-game scoring for city development 4. */
export function devEndGameVP(cityId: string, devLevel: number, s: SolverState, politicsCardCount: number): number {
  if (devLevel < 4) return 0;
  if (cityId === 'corinth') return 2 * totalKnowledge(s);
  if (cityId === 'thebes') {
    const minors = s.knowledge.greenMinor + s.knowledge.blueMinor + s.knowledge.redMinor;
    return 2 * minors;
  }
  if (cityId === 'sparta') return 4 * knowledgeCount(s, 'BLUE');
  if (cityId === 'athens') return 3 * politicsCardCount;
  return 0;
}

/** Whether Corinth dev-3 (ongoing progress-phase bonus + -1 cost) is unlocked. */
export function hasCorinthDev3(cityId: string, devLevel: number): boolean {
  return cityId === 'corinth' && devLevel >= 3;
}

/** Whether Sparta dev-1 (explore 1 less troop) is unlocked. */
export function hasSpartaDev1(cityId: string, devLevel: number): boolean {
  return cityId === 'sparta' && devLevel >= 1;
}

/** Apply per-round end-of-round tax effects specific to the city. (None currently affect scoring in this simplified model.) */
export function applyCityEndOfRoundEffects(
  _s: SolverState,
  _cityId: string,
  _devLevel: number,
  _opponents: FrozenOpponent[],
): void {
  // No per-round city tax effects beyond card-driven ones.
}

/** Compute current knowledge counts as simple numbers. */
export function totalByColor(k: KnowledgeCounts): { green: number; blue: number; red: number } {
  return {
    green: k.greenMinor + k.greenMajor,
    blue: k.blueMinor + k.blueMajor,
    red: k.redMinor + k.redMajor,
  };
}
