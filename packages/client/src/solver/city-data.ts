/**
 * Solver's knowledge of city-development effects.
 *
 * Each city has 4 developments that unlock sequentially. We model their
 * immediate effects, ongoing effects per action, and end-game scoring.
 */

import type { SolverState, FrozenOpponent, SolverAction, KnowledgeCounts } from './types';
import type { KnowledgeColor, ProgressTrackType } from '../types';
import { advanceProgressTrack, capTaxGloryTrack } from './tracks';
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
  options: {
    miletusDev2Tracks?: [ProgressTrackType, ProgressTrackType];
    spartaDev3Colors?: [KnowledgeColor, KnowledgeColor];
    argosDev2Reward?: 'TROOPS' | 'COINS' | 'VP' | 'CITIZENS';
    hasCard?: (id: string) => boolean;
  } = {},
): void {
  // corinth
  if (cityId === 'corinth' && level === 1) { s.coins += 4; return; }
  if (cityId === 'corinth' && level === 2) {
    const tokenCount = totalKnowledge(s);
    s.taxTrack = capTaxGloryTrack(s.taxTrack + tokenCount);
    s.philosophyTokens += tokenCount;
    return;
  }
  // thebes
  if (cityId === 'thebes' && level === 1) { advanceProgressTrack(s, 'MILITARY', 1); return; }
  if (cityId === 'thebes' && level === 3) { /* ONGOING: explore twice on MILITARY action */ return; }
  // miletus
  if (cityId === 'miletus' && level === 1) { advanceProgressTrack(s, 'ECONOMY', 1); return; }
  if (cityId === 'miletus' && level === 2) {
    const tracks = options.miletusDev2Tracks ?? ['ECONOMY', 'CULTURE'];
    advanceProgressTrack(s, tracks[0], 1);
    advanceProgressTrack(s, tracks[1], 1);
    return;
  }
  if (cityId === 'miletus' && level === 4) { s.victoryPoints += 15; return; }
  // sparta
  if (cityId === 'sparta' && level === 3) {
    // Take 2 military actions: each grants troopTrack troops, then optional explore.
    // Model as 2× militaryTrack troops plus 2 "free" minor-token explorations of a
    // useful color (since skull cost is small at minor level, we still pay roughly 2 troops each).
    // Sparta dev-2 ongoing (+1 tax on military) is always unlocked here, so add +2 tax.
    s.troopTrack += 2 * s.militaryTrack;
    if (s.cityId === 'sparta' && s.developmentLevel >= 2) s.taxTrack = capTaxGloryTrack(s.taxTrack + 2);
    // Rough model: pay 2 troops per minor explore (after Sparta dev-1 discount: 1 each)
    const discount = 1; // sparta dev-1 is unlocked once at dev-3
    const costPerExplore = Math.max(1, 2 - discount);
    const colors = options.spartaDev3Colors ?? ['BLUE', 'BLUE'];
    for (let i = 0; i < 2; i++) {
      if (s.troopTrack >= costPerExplore) {
        s.troopTrack -= costPerExplore;
        const color = colors[i];
        if (color === 'GREEN') s.knowledge.greenMinor += 1;
        else if (color === 'BLUE') s.knowledge.blueMinor += 1;
        else s.knowledge.redMinor += 1;
      }
    }
    return;
  }
  // olympia
  if (cityId === 'olympia' && level === 1) { s.taxTrack = capTaxGloryTrack(s.taxTrack + 1); return; }
  if (cityId === 'olympia' && level === 3) { advanceProgressTrack(s, 'CULTURE', 2); return; }
  if (cityId === 'olympia' && level === 4) {
    // Take 3 culture actions. Each culture action grants VP = cultureTrack.
    // We also apply Olympia dev-2's ongoing bonus (+1 troop +1 scroll on culture) per action.
    for (let i = 0; i < 3; i++) {
      s.victoryPoints += s.cultureTrack;
      // Olympia dev-2 is guaranteed here (dev-4 implies all lower devs unlocked)
      s.troopTrack += 1;
      s.philosophyTokens += 1;
      if (options.hasCard?.('stoa-poikile')) s.coins += 2;
      if (options.hasCard?.('persians')) s.troopTrack += 2;
    }
    return;
  }
  // argos
  if (cityId === 'argos' && level === 1) { s.troopTrack += 2; return; }
  if (cityId === 'argos' && level === 2) {
    const reward = options.argosDev2Reward ?? 'VP';
    if (reward === 'TROOPS') s.troopTrack += 2;
    else if (reward === 'COINS') s.coins += 3;
    else if (reward === 'CITIZENS') s.citizenTrack = Math.min(15, s.citizenTrack + 5);
    else s.victoryPoints += 4;
    return;
  }
  if (cityId === 'argos' && level === 3) { advanceProgressTrack(s, 'MILITARY', 1); return; }
  if (cityId === 'argos' && level === 4) { s.gloryTrack = capTaxGloryTrack(s.gloryTrack + 2); return; }
  // athens
  if (cityId === 'athens' && level === 1) { s.philosophyTokens += 3; return; }
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
    s.taxTrack = capTaxGloryTrack(s.taxTrack + 1);
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

/** Thebes dev-2: lose 1 glory → gain 2 drachma + 4 VP. Activatable any time. */
export function canActivateThebesDev2(
  s: SolverState,
  cityId: string,
  devLevel: number,
): boolean {
  return cityId === 'thebes' && devLevel >= 2 && s.gloryTrack >= 1;
}

export function applyThebesDev2Activation(s: SolverState, count: number): void {
  const uses = Math.max(0, Math.min(count, s.gloryTrack));
  if (uses <= 0) return;
  s.gloryTrack -= uses;
  s.coins += 2 * uses;
  s.victoryPoints += 4 * uses;
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
    return 3 * minors;
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
