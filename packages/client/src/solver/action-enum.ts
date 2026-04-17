/**
 * Action-phase enumeration for the solver.
 *
 * Each round, after already-taken actions, the player has (3 - alreadyTaken) slots.
 * We enumerate a pruned set of plausible plans (not every permutation) to keep
 * the branching factor manageable.
 */

import type { SolverState, FrozenOpponent, ActionChoice } from './types';
import type { KnowledgeToken, KnowledgeColor, PoliticsCard } from '../types';
import { applyAction } from './transitions';
import { cloneState, totalKnowledge } from './card-data';
import { devKnowledgeRequirement, devDrachmaCost } from './city-data';

/** Candidate action-phase outcome: a sequence of choices + resulting state. */
export interface ActionPlan {
  choices: ActionChoice[];
  state: SolverState;
}

/**
 * Generate candidate ActionChoices for a single slot given the state.
 * Returns a small pruned list of options.
 */
function candidateSingleChoices(
  s: SolverState,
  cardIds: string[],
  allCards: PoliticsCard[],
  _hasCardFn: (id: string) => boolean,
): ActionChoice[] {
  const out: ActionChoice[] = [];

  // Base 4
  out.push({ type: 'PHILOSOPHY' });
  out.push({ type: 'CULTURE' });
  out.push({ type: 'TRADE', buyMinor: null });
  // TRADE with a buy (only one heuristic: buy the color we need least for dev or cards)
  const colorToBuy = pickMinorColorToBuy(s, allCards);
  if (colorToBuy) out.push({ type: 'TRADE', buyMinor: colorToBuy });
  // MILITARY with 1 or 2 tokens explored
  const exploreOptions = enumerateExploreChoices(s, allCards);
  for (const ex of exploreOptions) out.push({ type: 'MILITARY', explore: ex });

  // POLITICS — one choice per playable card in hand
  for (let i = 0; i < cardIds.length; i++) {
    const bit = 1 << i;
    if ((s.handMask & bit) === 0) continue;
    const card = allCards[i];
    if (!card) continue;
    if (!canPlayCard(s, card)) continue;
    // Philosophy pairs needed? Cost & knowledge check.
    const pairs = philosophyPairsNeeded(s, card);
    out.push({ type: 'POLITICS', cardIndex: i, philosophyPairs: pairs });
  }

  // DEVELOPMENT — if a new level is unlockable
  if (s.developmentLevel < 4) {
    const nextLvl = s.developmentLevel + 1;
    const req = devKnowledgeRequirement(s.cityId, nextLvl);
    const cost = devDrachmaCost(s.cityId, nextLvl);
    if (s.coins >= cost && meetsReqSolver(s, req, 0)) {
      out.push({ type: 'DEVELOPMENT', philosophyPairs: 0 });
    } else {
      // Try with philosophy pairs
      for (let pairs = 1; pairs <= 3; pairs++) {
        if (s.philosophyTokens < pairs * 2) break;
        if (s.coins >= cost && meetsReqSolver(s, req, pairs)) {
          out.push({ type: 'DEVELOPMENT', philosophyPairs: pairs });
          break;
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
  // Single minor of each color
  for (const c of colors) {
    options.push([{ id: `${c}-minor-explore`, color: c, tokenType: 'MINOR' }]);
  }
  // Single major of most-needed color (if troops allow)
  const needed = pickMinorColorToBuy(s, allCards) ?? 'GREEN';
  options.push([{ id: `${needed}-major-explore`, color: needed, tokenType: 'MAJOR' }]);
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
): ActionPlan[] {
  if (slotsLeft <= 0) return [{ choices: [], state: s }];

  const hasCardFn = (id: string) => {
    const idx = cardIds.indexOf(id);
    if (idx < 0) return false;
    return (s.playedMask & (1 << idx)) !== 0;
  };

  const candidates = candidateSingleChoices(s, cardIds, allCards, hasCardFn);

  // Score each candidate by a cheap state-transition evaluation
  const scored: { choice: ActionChoice; next: SolverState; score: number }[] = [];
  for (const c of candidates) {
    const next = cloneState(s);
    applyAction(next, c, cardIds, opponents, (id) => {
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
    const subPlans = enumerateActionPlans(t.next, slotsLeft - 1, cardIds, allCards, opponents, topK);
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
  // Rough: VP + 1 per coin + 3 per knowledge + 2 per scroll + 2 per troop + track levels
  return (
    s.victoryPoints +
    0.5 * s.coins +
    3 * totalKnowledge(s) +
    1.5 * s.philosophyTokens +
    0.3 * s.troopTrack +
    2 * (s.economyTrack + s.cultureTrack + s.militaryTrack) +
    2 * s.taxTrack +
    4 * s.gloryTrack +
    3 * s.developmentLevel
  );
}
