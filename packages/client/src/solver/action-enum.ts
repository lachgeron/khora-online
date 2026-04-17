/**
 * Action-phase enumeration for the solver.
 *
 * Each round, after already-taken actions, the player has (3 - alreadyTaken) slots.
 * We enumerate a pruned set of plausible plans (not every permutation) to keep
 * the branching factor manageable.
 */

import type { SolverState, FrozenOpponent, ActionChoice, SolverAction } from './types';
import type { KnowledgeToken, KnowledgeColor, PoliticsCard } from '../types';
import { applyAction } from './transitions';
import { cloneState, totalKnowledge, majorCount, popcount, knowledgeCount } from './card-data';
import { devKnowledgeRequirement, devDrachmaCost, hasThebesDev3 } from './city-data';

/** Candidate action-phase outcome: a sequence of choices + resulting state. */
export interface ActionPlan {
  choices: ActionChoice[];
  state: SolverState;
}

/**
 * Generate candidate ActionChoices for a single slot given the state.
 * Excludes any action already used this round (each action slot activates at most once).
 */
function candidateSingleChoices(
  s: SolverState,
  cardIds: string[],
  allCards: PoliticsCard[],
  usedActions: Set<SolverAction>,
): ActionChoice[] {
  const out: ActionChoice[] = [];

  if (!usedActions.has('PHILOSOPHY')) out.push({ type: 'PHILOSOPHY' });
  if (!usedActions.has('CULTURE')) out.push({ type: 'CULTURE' });
  if (!usedActions.has('TRADE')) {
    out.push({ type: 'TRADE', buyMinor: null });
    // Enumerate all 3 buy-color options when affordable, not only the "most needed" color.
    if (s.coins >= 3) {
      const colors: KnowledgeColor[] = ['GREEN', 'BLUE', 'RED'];
      for (const c of colors) out.push({ type: 'TRADE', buyMinor: c });
    }
  }
  if (!usedActions.has('MILITARY') && s.troopTrack >= 1) {
    const exploreOptions = enumerateExploreChoices(s, allCards);
    for (const ex of exploreOptions) out.push({ type: 'MILITARY', explore: ex });
    // Option to military without exploring (e.g. just to get troops via ongoing effects) — skipped, low value
  }

  // POLITICS — one choice per playable card in hand (the politics slot can play 1 card)
  if (!usedActions.has('POLITICS')) {
    for (let i = 0; i < cardIds.length; i++) {
      const bit = 1 << i;
      if ((s.handMask & bit) === 0) continue;
      const card = allCards[i];
      if (!card) continue;
      if (!canPlayCard(s, card)) continue;
      const pairs = philosophyPairsNeeded(s, card);
      out.push({ type: 'POLITICS', cardIndex: i, philosophyPairs: pairs });
    }
  }

  // DEVELOPMENT — if a new level is unlockable
  if (!usedActions.has('DEVELOPMENT') && s.developmentLevel < 4) {
    const nextLvl = s.developmentLevel + 1;
    const req = devKnowledgeRequirement(s.cityId, nextLvl);
    const cost = devDrachmaCost(s.cityId, nextLvl);
    if (s.coins >= cost) {
      if (meetsReqSolver(s, req, 0)) {
        out.push({ type: 'DEVELOPMENT', philosophyPairs: 0 });
      } else {
        for (let pairs = 1; pairs <= 4; pairs++) {
          if (s.philosophyTokens < pairs * 2) break;
          if (meetsReqSolver(s, req, pairs)) {
            out.push({ type: 'DEVELOPMENT', philosophyPairs: pairs });
            break;
          }
        }
      }
    }
  }

  return out;
}

function canPlayCard(s: SolverState, card: PoliticsCard): boolean {
  if (s.coins < card.cost) return false;
  const req = card.knowledgeRequirement;
  return meetsReqSolver(s, req, 0) ||
    meetsReqSolver(s, req, 1) ||
    meetsReqSolver(s, req, 2) ||
    meetsReqSolver(s, req, 3);
}

function philosophyPairsNeeded(s: SolverState, card: PoliticsCard): number {
  const req = card.knowledgeRequirement;
  for (let pairs = 0; pairs <= 3; pairs++) {
    if (s.philosophyTokens < pairs * 2) break;
    if (meetsReqSolver(s, req, pairs)) return pairs;
  }
  return 0;
}

function meetsReqSolver(
  s: SolverState,
  req: { green: number; blue: number; red: number },
  philosophyPairs: number,
): boolean {
  const g = s.knowledge.greenMinor + s.knowledge.greenMajor;
  const b = s.knowledge.blueMinor + s.knowledge.blueMajor;
  const r = s.knowledge.redMinor + s.knowledge.redMajor;
  const totalHave = Math.min(g, req.green) + Math.min(b, req.blue) + Math.min(r, req.red);
  const totalRequired = req.green + req.blue + req.red;
  const shortfall = totalRequired - totalHave;
  if (philosophyPairs === 0) return shortfall <= 0;
  if (s.philosophyTokens < philosophyPairs * 2) return false;
  return shortfall <= philosophyPairs;
}

/** Heuristic: which minor to buy to fill card/dev requirements fastest. */
function pickMinorColorToBuy(s: SolverState, allCards: PoliticsCard[]): KnowledgeColor | null {
  // Compute deficits vs. all cards in hand + next dev.
  const g = s.knowledge.greenMinor + s.knowledge.greenMajor;
  const b = s.knowledge.blueMinor + s.knowledge.blueMajor;
  const r = s.knowledge.redMinor + s.knowledge.redMajor;
  let deficitG = 0, deficitB = 0, deficitR = 0;

  for (let i = 0; i < allCards.length; i++) {
    const bit = 1 << i;
    if ((s.handMask & bit) === 0) continue;
    const card = allCards[i];
    if (!card) continue;
    const req = card.knowledgeRequirement;
    deficitG = Math.max(deficitG, Math.max(0, req.green - g));
    deficitB = Math.max(deficitB, Math.max(0, req.blue - b));
    deficitR = Math.max(deficitR, Math.max(0, req.red - r));
  }

  if (s.developmentLevel < 4) {
    const req = devKnowledgeRequirement(s.cityId, s.developmentLevel + 1);
    deficitG = Math.max(deficitG, Math.max(0, req.green - g));
    deficitB = Math.max(deficitB, Math.max(0, req.blue - b));
    deficitR = Math.max(deficitR, Math.max(0, req.red - r));
  }

  if (deficitG >= deficitB && deficitG >= deficitR && deficitG > 0) return 'GREEN';
  if (deficitB >= deficitR && deficitB > 0) return 'BLUE';
  if (deficitR > 0) return 'RED';
  return null;
}

/** Enumerate a few useful explore choices. */
function enumerateExploreChoices(s: SolverState, allCards: PoliticsCard[]): KnowledgeToken[][] {
  const options: KnowledgeToken[][] = [];
  const colors: KnowledgeColor[] = ['GREEN', 'BLUE', 'RED'];
  // Option 0: skip exploration (still gain troops from the action)
  options.push([]);
  // Single minor of each color
  for (const c of colors) {
    options.push([{ id: `${c}-minor-explore`, color: c, tokenType: 'MINOR' }]);
  }
  // Single major of most-needed color
  const needed = pickMinorColorToBuy(s, allCards) ?? 'GREEN';
  options.push([{ id: `${needed}-major-explore`, color: needed, tokenType: 'MAJOR' }]);
  // Thebes dev-3 enables double exploration
  if (hasThebesDev3(s.cityId, s.developmentLevel)) {
    for (const a of colors) {
      for (const b of colors) {
        options.push([
          { id: `${a}-minor-ex1`, color: a, tokenType: 'MINOR' },
          { id: `${b}-minor-ex2`, color: b, tokenType: 'MINOR' },
        ]);
      }
    }
    options.push([
      { id: `${needed}-major-ex1`, color: needed, tokenType: 'MAJOR' },
      { id: `${needed}-minor-ex2`, color: needed, tokenType: 'MINOR' },
    ]);
  }
  return options;
}

/**
 * Enumerate candidate ordered action sequences for the remaining slots this round.
 *
 * To bound branching: at each slot, take up to `topK` candidates ranked by a
 * cheap heuristic (immediate value), then recurse.
 */
export function enumerateActionPlans(
  s: SolverState,
  slotsLeft: number,
  cardIds: string[],
  allCards: PoliticsCard[],
  opponents: FrozenOpponent[],
  topK: number,
  usedActions: Set<SolverAction> = new Set(s.actionsAlreadyTaken),
): ActionPlan[] {
  if (slotsLeft <= 0) return [{ choices: [], state: s }];

  const candidates = candidateSingleChoices(s, cardIds, allCards, usedActions);
  if (candidates.length === 0) return [{ choices: [], state: s }];

  const scored: { choice: ActionChoice; next: SolverState; score: number }[] = [];
  for (const c of candidates) {
    const next = cloneState(s);
    applyAction(next, c, cardIds, allCards, opponents, (id) => {
      const idx = cardIds.indexOf(id);
      return idx >= 0 && (next.playedMask & (1 << idx)) !== 0;
    });
    const score = heuristicScore(next) - heuristicScore(s);
    scored.push({ choice: c, next, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  const plans: ActionPlan[] = [];
  for (const t of top) {
    const nextUsed = new Set(usedActions);
    nextUsed.add(t.choice.type);
    const subPlans = enumerateActionPlans(t.next, slotsLeft - 1, cardIds, allCards, opponents, topK, nextUsed);
    for (const sp of subPlans) {
      plans.push({
        choices: [t.choice, ...sp.choices],
        state: sp.state,
      });
    }
  }
  return plans;
}

/** Cheap heuristic: estimate state value for ranking action candidates. */
export function heuristicScore(s: SolverState): number {
  // Weight roughly by expected VP contribution over the remaining game.
  const roundsLeft = Math.max(0, 9 - s.round + 1);
  const minors = s.knowledge.greenMinor + s.knowledge.blueMinor + s.knowledge.redMinor;
  const majors = majorCount(s);

  // Tax grants 1 drachma/round. Roughly 0.4-0.5 VP/coin over a game (coins feed cards/devs).
  const taxVP = s.taxTrack * roundsLeft * 0.9;

  // Glory × majors end-game scoring. We also anticipate 1 extra major per 2 rounds left
  // (via Military action) so Glory contributes even when majors == 0 right now.
  const expectedFinalMajors = majors + roundsLeft * 0.35;
  const gloryVP = s.gloryTrack * expectedFinalMajors;
  // Each major accrued compounds with current+expected future glory.
  const majorBonus = majors * 3;                          // a major is ~3 VP via glory

  // Knowledge feeds dev unlocks + card requirements. Minors also feed Trade/endgame cards.
  const minorsKnow = 1.8 * minors;
  const majorsKnow = 2.5 * majors;

  // Progress-track VP potential per level — includes milestones indirectly via state.
  // Heavier on Culture (unlocks 3rd die at L4) and Military (each L grants glory).
  const progressVal =
    2.5 * s.economyTrack +
    3.0 * s.cultureTrack +
    3.5 * s.militaryTrack;

  // Big discrete jump when 3rd die unlocks at Culture 4: ~extra action per round.
  const thirdDieBonus = s.cultureTrack >= 4 ? roundsLeft * 4.0 : 0;

  // Development levels are end-game VP plus immediate effects. Dev-4 often huge.
  const devVal = 6 * s.developmentLevel + cityDev4AnticipatedVP(s);
  // Proximity-to-next-dev: reward being close to unlocking the next development.
  const devProximity = nextDevProximityBonus(s, roundsLeft);

  // Troops: exploration potential. 2 troops → 1 minor (worth ~1.8). Cap at useful level.
  const usableTroops = Math.min(s.troopTrack, roundsLeft * 3);
  const troopVal = usableTroops * 0.45;

  // Philosophy scrolls substitute for knowledge (2 scrolls = 1 req) or fund extra progress.
  const usableScrolls = Math.min(s.philosophyTokens, roundsLeft * 2);
  const scrollVal = usableScrolls * 0.9;

  // Coins have declining value near end-of-game (nothing to spend them on).
  const usableCoins = Math.min(s.coins, roundsLeft * 6);
  const coinVal = usableCoins * 0.4;

  // Played cards: ongoing value over remaining rounds. Each play is ~1-2 VP/round avg.
  const handCount = popcount(s.handMask);
  const playedCount = popcount(s.playedMask);
  const handLatent = Math.min(handCount, roundsLeft) * 0.8;     // latent only
  const playedVal = playedCount * (1.5 + 1.0 * roundsLeft);     // accrues over rounds

  return (
    s.victoryPoints +
    coinVal +
    minorsKnow +
    majorsKnow +
    scrollVal +
    troopVal +
    progressVal +
    thirdDieBonus +
    taxVP +
    gloryVP +
    majorBonus +
    devVal +
    devProximity +
    handLatent +
    playedVal
  );
}

/**
 * Anticipated end-game VP from the city's dev-4 given the current state.
 * Only credited if Dev-4 is actually reachable (not already past, and within reach).
 */
function cityDev4AnticipatedVP(s: SolverState): number {
  if (s.developmentLevel >= 4) {
    // Already at Dev-4 — the payoff is baked into scoreTrack/playedMask; give small premium.
    return 12;
  }
  // Estimate: if reasonable chance to reach Dev-4, credit a portion of its eventual VP.
  switch (s.cityId) {
    case 'miletus': return 12;                          // +15 VP immediate
    case 'corinth': return Math.min(18, 2 * totalKnowledge(s)); // 2× final knowledge
    case 'thebes': {
      const minors = s.knowledge.greenMinor + s.knowledge.blueMinor + s.knowledge.redMinor;
      return Math.min(16, 2 * minors);
    }
    case 'sparta': return Math.min(16, 4 * knowledgeCount(s, 'BLUE'));
    case 'athens': return Math.min(18, 3 * popcount(s.playedMask));
    case 'argos': return 10;                             // dev-4 grants +2 glory
    case 'olympia': return 10;                           // dev-4 grants 3 culture actions
    default: return 8;
  }
}

/** Reward approaching the next development unlock (knowledge req coverage + affordability). */
function nextDevProximityBonus(s: SolverState, roundsLeft: number): number {
  if (s.developmentLevel >= 4 || roundsLeft <= 0) return 0;
  const nextLvl = s.developmentLevel + 1;
  const req = devKnowledgeRequirement(s.cityId, nextLvl);
  const cost = devDrachmaCost(s.cityId, nextLvl);
  const g = s.knowledge.greenMinor + s.knowledge.greenMajor;
  const b = s.knowledge.blueMinor + s.knowledge.blueMajor;
  const r = s.knowledge.redMinor + s.knowledge.redMajor;
  const have = Math.min(g, req.green) + Math.min(b, req.blue) + Math.min(r, req.red);
  const total = req.green + req.blue + req.red;
  const shortfall = Math.max(0, total - have);
  // Philosophy scrolls can cover 1 req each (2 scrolls = 1 sub). Model coverage as fractional.
  const scrollCoverage = Math.min(shortfall, Math.floor(s.philosophyTokens / 2));
  const effectiveShortfall = shortfall - scrollCoverage;
  // Coverage ratio: 1.0 if fully met, decaying as shortfall grows.
  const coverageRatio = total > 0 ? (total - effectiveShortfall) / total : 1;
  // If affordability is missing, discount heavily.
  const affordFactor = s.coins >= cost ? 1 : 0.5;
  // Base bonus scales with how valuable the next dev is for this city.
  const nextDevValue = nextLvl === 4 ? 8 : nextLvl === 3 ? 5 : 3;
  return coverageRatio * affordFactor * nextDevValue;
}
