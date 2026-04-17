/**
 * Action-phase enumeration for the solver.
 *
 * Each round, after already-taken actions, the player has (3 - alreadyTaken) slots.
 * We enumerate a pruned set of plausible plans (not every permutation) to keep
 * the branching factor manageable.
 */

import type { SolverState, FrozenOpponent, ActionChoice, SolverAction, BoardExplorationToken } from './types';
import type { KnowledgeColor, PoliticsCard } from '../types';
import { applyAction } from './transitions';
import { cloneState, totalKnowledge, majorCount, popcount, knowledgeCount, exploreTroopDiscount, endGameCardVP } from './card-data';
import { devKnowledgeRequirement, devDrachmaCost, hasThebesDev3, hasSpartaDev1 } from './city-data';

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
  boardTokens: BoardExplorationToken[],
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
  if (!usedActions.has('MILITARY')) {
    const exploreOptions = enumerateExploreChoices(s, allCards, boardTokens);
    for (const ex of exploreOptions) out.push({ type: 'MILITARY', explore: ex });
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

/**
 * Enumerate explore choices from the actual central board.
 *
 * We consider only affordable tokens (troopTrack meets militaryRequirement; skull cost ≤ troops
 * after the military action's base troop gain). For each, we score by how well it addresses
 * current card/dev deficits and how much direct VP/coin bonus it delivers; we keep the top few.
 *
 * Thebes dev-3 grants two explorations per action — we enumerate the best top-N pairs.
 */
function enumerateExploreChoices(
  s: SolverState,
  allCards: PoliticsCard[],
  boardTokens: BoardExplorationToken[],
): BoardExplorationToken[][] {
  const options: BoardExplorationToken[][] = [];
  options.push([]); // skip

  // The troop value available at the MOMENT of exploration is troopTrack + militaryTrack
  // (action base grants militaryTrack troops before exploring).
  const availableTroops = s.troopTrack + s.militaryTrack;
  const hasCardFn = (id: string): boolean => {
    const idx = _cardIdIndex(id, allCards);
    return idx >= 0 && (s.playedMask & (1 << idx)) !== 0;
  };
  const discount = exploreTroopDiscount(hasCardFn) + (hasSpartaDev1(s.cityId, s.developmentLevel) ? 1 : 0);

  const deficit = deficitMap(s, allCards);

  // Score each token for inclusion. Higher = better candidate.
  const scored: { tok: BoardExplorationToken; score: number }[] = [];
  for (const tok of boardTokens) {
    if (tok.militaryRequirement > availableTroops) continue;
    const cost = Math.max(0, tok.skullCost - discount);
    if (cost > availableTroops) continue;

    // Deficit coverage: how many required color-units does this token fill?
    const colorDeficit =
      tok.color === 'GREEN' ? deficit.g :
      tok.color === 'BLUE' ? deficit.b :
      deficit.r;
    const deficitFill = Math.min(colorDeficit, 1);

    // Raw value: bonusCoins ~ 0.6 VP, bonusVP 1:1, major > minor, color-fill big bonus.
    const colorValue = deficitFill * 4;
    const majorBonus = tok.tokenType === 'MAJOR' ? 3 : 1.5;   // majors fuel Glory × Majors endgame
    const bonus = tok.bonusVP + tok.bonusCoins * 0.6;
    // Troop cost penalty: ~0.4 VP per troop spent (rough conversion).
    const troopPenalty = cost * 0.4;
    // Persepolis is massive — 3 majors at once
    const persepolisBonus = tok.isPersepolis ? 15 : 0;

    const score = colorValue + majorBonus + bonus + persepolisBonus - troopPenalty;
    scored.push({ tok, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const thebesDouble = hasThebesDev3(s.cityId, s.developmentLevel);
  const topSingles = scored.slice(0, thebesDouble ? 8 : 12);

  // Single-token explores
  for (const x of topSingles) options.push([x.tok]);

  // Double-token explores (Thebes dev-3): pair top 6 with next 6, skipping duplicates.
  if (thebesDouble) {
    const pool = topSingles.slice(0, 6);
    for (let i = 0; i < pool.length; i++) {
      for (let j = 0; j < pool.length; j++) {
        if (i === j) continue;           // distinct ids
        if (pool[i].tok.id === pool[j].tok.id) continue;
        const costI = Math.max(0, pool[i].tok.skullCost - discount);
        const costJ = Math.max(0, pool[j].tok.skullCost - discount);
        if (costI + costJ > availableTroops) continue;
        // Both tokens must meet req; second token's req is against troops _after_ first pay,
        // but game-wise the req is checked against current troopTrack before paying — we
        // approximate by checking both pass the initial check above.
        options.push([pool[i].tok, pool[j].tok]);
      }
    }
  }

  return options;
}

function _cardIdIndex(id: string, allCards: PoliticsCard[]): number {
  for (let i = 0; i < allCards.length; i++) if (allCards[i]?.id === id) return i;
  return -1;
}

/** Aggregated deficit per color across hand cards + next dev. */
function deficitMap(s: SolverState, allCards: PoliticsCard[]): { g: number; b: number; r: number } {
  const g = s.knowledge.greenMinor + s.knowledge.greenMajor;
  const b = s.knowledge.blueMinor + s.knowledge.blueMajor;
  const r = s.knowledge.redMinor + s.knowledge.redMajor;
  let dg = 0, db = 0, dr = 0;
  for (let i = 0; i < allCards.length; i++) {
    const bit = 1 << i;
    if ((s.handMask & bit) === 0) continue;
    const card = allCards[i];
    if (!card) continue;
    const req = card.knowledgeRequirement;
    dg = Math.max(dg, Math.max(0, req.green - g));
    db = Math.max(db, Math.max(0, req.blue - b));
    dr = Math.max(dr, Math.max(0, req.red - r));
  }
  if (s.developmentLevel < 4) {
    const req = devKnowledgeRequirement(s.cityId, s.developmentLevel + 1);
    dg = Math.max(dg, Math.max(0, req.green - g));
    db = Math.max(db, Math.max(0, req.blue - b));
    dr = Math.max(dr, Math.max(0, req.red - r));
  }
  return { g: dg, b: db, r: dr };
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
  boardTokens: BoardExplorationToken[],
  topK: number,
  usedActions: Set<SolverAction> = new Set(s.actionsAlreadyTaken),
): ActionPlan[] {
  if (slotsLeft <= 0) return [{ choices: [], state: s }];

  const candidates = candidateSingleChoices(s, cardIds, allCards, boardTokens, usedActions);
  if (candidates.length === 0) return [{ choices: [], state: s }];

  const scored: { choice: ActionChoice; next: SolverState; score: number }[] = [];
  const baseScore = heuristicScore(s, cardIds);
  for (const c of candidates) {
    const next = cloneState(s);
    applyAction(next, c, cardIds, allCards, opponents, (id) => {
      const idx = cardIds.indexOf(id);
      return idx >= 0 && (next.playedMask & (1 << idx)) !== 0;
    });
    const score = heuristicScore(next, cardIds) - baseScore;
    scored.push({ choice: c, next, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  const plans: ActionPlan[] = [];
  for (const t of top) {
    const nextUsed = new Set(usedActions);
    nextUsed.add(t.choice.type);
    // Mutate boardTokens view for subsequent slots: remove ids that were consumed by MILITARY explore.
    let nextTokens = boardTokens;
    if (t.choice.type === 'MILITARY' && t.choice.explore.length > 0) {
      const consumed = new Set(t.choice.explore.map(x => x.id));
      nextTokens = boardTokens.filter(x => !consumed.has(x.id));
    }
    const subPlans = enumerateActionPlans(t.next, slotsLeft - 1, cardIds, allCards, opponents, nextTokens, topK, nextUsed);
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
export function heuristicScore(s: SolverState, cardIds?: string[]): number {
  // Weight roughly by expected VP contribution over the remaining game.
  const roundsLeft = Math.max(0, 9 - s.round + 1);
  const minors = s.knowledge.greenMinor + s.knowledge.blueMinor + s.knowledge.redMinor;
  const majors = majorCount(s);

  // Tax grants drachma/round; drachma convert to VP via cards/devs at ~0.45 VP/coin.
  const taxVP = s.taxTrack * roundsLeft * 0.95;

  // Glory × majors end-game scoring. We also anticipate extra majors (~0.4/round left)
  // via Military exploration so Glory track still contributes even when majors == 0.
  const expectedFinalMajors = majors + roundsLeft * 0.4;
  const gloryVP = s.gloryTrack * expectedFinalMajors;
  // Each major accrued compounds with current+expected future glory.
  const majorBonus = majors * 3.5;

  // Knowledge feeds dev unlocks + card requirements + some endgame cards.
  const minorsKnow = 1.9 * minors;
  const majorsKnow = 2.8 * majors;

  // Progress-track VP potential per level — includes milestones indirectly via state.
  // Heavier on Culture (unlocks 3rd die at L4) and Military (each L grants glory).
  const progressVal =
    2.6 * s.economyTrack +
    3.2 * s.cultureTrack +
    3.6 * s.militaryTrack;

  // Big discrete jump when 3rd die unlocks at Culture 4: ~extra action per round.
  const thirdDieBonus = s.cultureTrack >= 4 ? roundsLeft * 4.5 : 0;

  // Development levels are end-game VP plus immediate effects. Dev-4 often huge.
  const devVal = 6 * s.developmentLevel + cityDev4AnticipatedVP(s);
  // Proximity-to-next-dev: reward being close to unlocking the next development.
  const devProximity = nextDevProximityBonus(s, roundsLeft);

  // Troops: exploration potential. Each troop consumed on a explore ~yields 0.5 VP.
  const usableTroops = Math.min(s.troopTrack, roundsLeft * 3);
  const troopVal = usableTroops * 0.5;

  // Philosophy scrolls substitute for knowledge (2 scrolls = 1 req) or fund extra progress.
  const usableScrolls = Math.min(s.philosophyTokens, roundsLeft * 2);
  const scrollVal = usableScrolls * 0.95;

  // Coins have declining value near end-of-game (nothing to spend them on).
  // Scaled down further in the last two rounds where coins often sit idle.
  const endGameCoinDecay = roundsLeft <= 1 ? 0.15 : roundsLeft <= 2 ? 0.25 : 0.45;
  const usableCoins = Math.min(s.coins, roundsLeft * 6);
  const coinVal = usableCoins * endGameCoinDecay;

  // Hand cards: each unplayed card has latent value (future immediate + ongoing + endgame).
  // If cardIds is available, we can estimate potential endgame contribution for hand cards
  // crudely — ignore for now but boost the generic per-card weight.
  const handCount = popcount(s.handMask);
  const playedCount = popcount(s.playedMask);
  const perHandLatent = roundsLeft >= 4 ? 3.2 : roundsLeft >= 2 ? 2.0 : 0.8;
  const handLatent = Math.min(handCount, roundsLeft) * perHandLatent;

  // Played cards: generic ongoing-bonus accrual. Each play nets ~1 VP immediately on
  // avg + ~1 VP/round in ongoing effects. Avoid double-counting against endgame VP below.
  const playedVal = playedCount * (1.0 + 0.8 * roundsLeft);

  // Played cards end-game VP: for cards with explicit endgame scoring (bank, austerity,
  // central-government, hall-of-statues, gold-reserve, heavy-taxes, proskenion,
  // diversification), score the anticipated endgame VP directly using the current state.
  let playedEndGameVP = 0;
  if (cardIds) {
    for (let i = 0; i < cardIds.length; i++) {
      const bit = 1 << i;
      if ((s.playedMask & bit) === 0) continue;
      playedEndGameVP += endGameCardVP(cardIds[i], s);
    }
  }

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
    playedVal +
    playedEndGameVP
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
