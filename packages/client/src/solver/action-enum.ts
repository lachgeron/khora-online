/**
 * Action-phase enumeration for the solver.
 *
 * Each round, after already-taken actions, the player has (3 - alreadyTaken) slots.
 * We enumerate a pruned set of plausible plans (not every permutation) to keep
 * the branching factor manageable.
 */

import type { SolverState, FrozenOpponent, ActionChoice, SolverAction, BoardExplorationToken, SolverDiceAssignment } from './types';
import type { KnowledgeColor, PoliticsCard, ProgressTrackType } from '../types';
import { ACTION_NUMBERS } from '../types';
import { applyAction } from './transitions';
import { cloneState, totalKnowledge, majorCount, popcount, knowledgeCount, exploreTroopDiscount, endGameCardVP, hasMaskBit } from './card-data';
import { devKnowledgeRequirement, devDrachmaCost, hasThebesDev3, hasSpartaDev1 } from './city-data';

/** Candidate action-phase outcome: a sequence of choices + resulting state. */
export interface ActionPlan {
  choices: ActionChoice[];
  state: SolverState;
  diceAssignments: SolverDiceAssignment[];
  citizenCost: number;
  philosophyTokensToSpend: number;
}

export interface ActionEnumerationOptions {
  diceRoll?: number[] | null;
  forcedAssignments?: SolverDiceAssignment[];
  citizenCostsAlreadyPaid?: boolean;
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
  const canTakeNext = (action: SolverAction): boolean =>
    !usedActions.has(action) && actionNumber(action) > highestUsedActionNumber(usedActions);

  if (canTakeNext('PHILOSOPHY')) out.push({ type: 'PHILOSOPHY' });
  if (canTakeNext('LEGISLATION') && !s.legislationDoneThisRound && s.deckCardIndices.length > 0) {
    const draw = s.deckCardIndices.slice(0, 2);
    for (const keepCardIndex of draw) out.push({ type: 'LEGISLATION', keepCardIndex });
  }
  if (canTakeNext('CULTURE')) out.push({ type: 'CULTURE' });
  if (canTakeNext('TRADE')) {
    out.push({ type: 'TRADE', buyMinor: null });
    // Enumerate all 3 buy-color options when affordable, not only the "most needed" color.
    const projectedTradeCoins = s.coins + s.economyTrack + 1 + (hasPlayedCard(s, allCards, 'diolkos') ? 1 : 0);
    const buyCost = hasPlayedCard(s, allCards, 'corinthian-columns') ? 3 : 5;
    if (projectedTradeCoins >= buyCost) {
      const colors: KnowledgeColor[] = ['GREEN', 'BLUE', 'RED'];
      for (const c of colors) out.push({ type: 'TRADE', buyMinor: c });
    }
  }
  if (canTakeNext('MILITARY')) {
    const exploreOptions = enumerateExploreChoices(s, allCards);
    for (const ex of exploreOptions) out.push({ type: 'MILITARY', explore: ex });
  }

  // POLITICS — one choice per playable card in hand (the politics slot can play 1 card)
  if (canTakeNext('POLITICS')) {
    for (let i = 0; i < cardIds.length; i++) {
      if (!canConsiderPoliticsCard(s, i)) continue;
      const card = allCards[i];
      if (!card) continue;
      if (!canPlayCard(s, card)) continue;
      const pairs = philosophyPairsNeeded(s, card);
      if (card.id === 'scholarly-welcome') {
        const colors: KnowledgeColor[] = ['GREEN', 'BLUE', 'RED'];
        for (const color of colors) {
          out.push({ type: 'POLITICS', cardIndex: i, philosophyPairs: pairs, scholarlyWelcomeColor: color });
        }
      } else {
        out.push({ type: 'POLITICS', cardIndex: i, philosophyPairs: pairs });
      }
    }
  }

  // DEVELOPMENT — if a new level is unlockable
  if (canTakeNext('DEVELOPMENT') && s.developmentLevel < 4) {
    const nextLvl = s.developmentLevel + 1;
    const req = devKnowledgeRequirement(s.cityId, nextLvl);
    const cost = devDrachmaCost(s.cityId, nextLvl);
    if (s.coins >= cost) {
      if (meetsReqSolver(s, req, 0)) {
        pushDevelopmentChoices(out, s, nextLvl, 0);
      } else {
        for (let pairs = 1; pairs <= 4; pairs++) {
          if (s.philosophyTokens < pairs * 2) break;
          if (meetsReqSolver(s, req, pairs)) {
            pushDevelopmentChoices(out, s, nextLvl, pairs);
            break;
          }
        }
      }
    }
  }

  return out;
}

function hasPlayedCard(s: SolverState, allCards: PoliticsCard[], cardId: string): boolean {
  const idx = _cardIdIndex(cardId, allCards);
  return idx >= 0 && hasMaskBit(s.playedMask, idx);
}

function canConsiderPoliticsCard(s: SolverState, cardIndex: number): boolean {
  if (hasMaskBit(s.playedMask, cardIndex)) return false;
  return hasMaskBit(s.handMask, cardIndex);
}

function actionNumber(action: SolverAction): number {
  return ACTION_NUMBERS[action];
}

function highestUsedActionNumber(usedActions: Set<SolverAction>): number {
  let highest = -1;
  for (const action of usedActions) {
    highest = Math.max(highest, actionNumber(action));
  }
  return highest;
}

function pushDevelopmentChoices(
  out: ActionChoice[],
  s: SolverState,
  nextLevel: number,
  philosophyPairs: number,
): void {
  if (s.cityId === 'miletus' && nextLevel === 2) {
    const pairs: Array<[ProgressTrackType, ProgressTrackType]> = [
      ['ECONOMY', 'CULTURE'],
      ['ECONOMY', 'MILITARY'],
      ['CULTURE', 'MILITARY'],
    ];
    for (const tracks of pairs) out.push({ type: 'DEVELOPMENT', philosophyPairs, miletusDev2Tracks: tracks });
    return;
  }
  if (s.cityId === 'sparta' && nextLevel === 3) {
    const colors: KnowledgeColor[] = ['GREEN', 'BLUE', 'RED'];
    for (const a of colors) {
      for (const b of colors) {
        out.push({ type: 'DEVELOPMENT', philosophyPairs, spartaDev3Colors: [a, b] });
      }
    }
    return;
  }
  if (s.cityId === 'argos' && nextLevel === 2) {
    for (const reward of ['TROOPS', 'COINS', 'VP', 'CITIZENS'] as const) {
      out.push({ type: 'DEVELOPMENT', philosophyPairs, argosDev2Reward: reward });
    }
    return;
  }
  out.push({ type: 'DEVELOPMENT', philosophyPairs });
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
): BoardExplorationToken[][] {
  const options: BoardExplorationToken[][] = [];
  options.push([]); // skip

  // The troop value available at the MOMENT of exploration is troopTrack + militaryTrack
  // (action base grants militaryTrack troops before exploring).
  const availableTroops = s.troopTrack + s.militaryTrack;
  const hasCardFn = (id: string): boolean => {
    const idx = _cardIdIndex(id, allCards);
    return idx >= 0 && hasMaskBit(s.playedMask, idx);
  };
  const discount = exploreTroopDiscount(hasCardFn) + (hasSpartaDev1(s.cityId, s.developmentLevel) ? 1 : 0);

  const deficit = deficitMap(s, allCards);

  // Score each token for inclusion. Higher = better candidate.
  const scored: { tok: BoardExplorationToken; score: number }[] = [];
  for (const tok of s.boardTokens) {
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
    if (!canConsiderPoliticsCard(s, i)) continue;
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
  topK: number,
  options: ActionEnumerationOptions = {},
  usedActions: Set<SolverAction> = new Set(s.actionsAlreadyTaken),
  depth: number = 0,
  currentChoices: ActionChoice[] = [],
  currentCitizenCost: number = 0,
): ActionPlan[] {
  if (slotsLeft <= 0) {
    const finalized = finalizeActionPlan(s, [], [], cardIds, allCards, opponents, options);
    return finalized ? [finalized] : [];
  }

  const candidates = candidateSingleChoices(s, cardIds, allCards, usedActions);
  const forcedAction = options.forcedAssignments?.[depth]?.action;
  const filteredCandidates = forcedAction
    ? candidates.filter(c => c.type === forcedAction)
    : candidates;
  if (filteredCandidates.length === 0) {
    const finalized = finalizeActionPlan(s, [], [], cardIds, allCards, opponents, options);
    return finalized ? [finalized] : [];
  }

  const scored: { choice: ActionChoice; next: SolverState; score: number }[] = [];
  const baseScore = heuristicScore(s, cardIds);
  for (const c of filteredCandidates) {
    const prefixChoices = [...currentChoices, c];
    const prefixAssignment = chooseDiceAssignment(prefixChoices, options, []);
    if (!prefixAssignment) continue;
    const incrementalCitizenCost = Math.max(0, prefixAssignment.citizenCost - currentCitizenCost);
    const dicePayment = options.citizenCostsAlreadyPaid
      ? { citizenAfter: s.citizenTrack, philosophyAfter: s.philosophyTokens }
      : payDiceCitizenCost(s.citizenTrack, s.philosophyTokens, incrementalCitizenCost);
    if (!dicePayment) continue;
    const next = cloneState(s);
    if (!options.citizenCostsAlreadyPaid) {
      next.citizenTrack = dicePayment.citizenAfter;
      next.philosophyTokens = dicePayment.philosophyAfter;
    }
    const ok = applyAction(next, c, cardIds, allCards, opponents, (id) => {
      const idx = cardIds.indexOf(id);
      return idx >= 0 && hasMaskBit(next.playedMask, idx);
    });
    if (!ok) continue;
    const score = heuristicScore(next, cardIds) - baseScore
      + choicePriorityBonus(s, next, c, cardIds);
    scored.push({ choice: c, next, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);

  const plans: ActionPlan[] = [];
  for (const t of top) {
    const nextUsed = new Set(usedActions);
    nextUsed.add(t.choice.type);
    // All actions consume 1 slot.
    const nextChoices = [...currentChoices, t.choice];
    const nextAssignment = chooseDiceAssignment(nextChoices, options, []);
    const nextCitizenCost = nextAssignment?.citizenCost ?? currentCitizenCost;
    const subPlans = enumerateActionPlans(t.next, slotsLeft - 1, cardIds, allCards, opponents, topK, options, nextUsed, depth + 1, nextChoices, nextCitizenCost);
    for (const sp of subPlans) {
      const choices = [t.choice, ...sp.choices];
      if (depth === 0) {
        const finalized = finalizeActionPlan(s, choices, sp.diceAssignments, cardIds, allCards, opponents, options);
        if (!finalized) continue;
        plans.push(finalized);
        continue;
      }
      plans.push({
        choices,
        state: sp.state,
        diceAssignments: sp.diceAssignments,
        citizenCost: sp.citizenCost,
        philosophyTokensToSpend: sp.philosophyTokensToSpend,
      });
    }
  }
  return plans;
}

function finalizeActionPlan(
  initial: SolverState,
  choices: ActionChoice[],
  existingAssignments: SolverDiceAssignment[],
  cardIds: string[],
  allCards: PoliticsCard[],
  opponents: FrozenOpponent[],
  options: ActionEnumerationOptions,
): ActionPlan | null {
  const assignment = chooseDiceAssignment(choices, options, existingAssignments);
  if (!assignment) return null;
  const dicePayment = options.citizenCostsAlreadyPaid
    ? { citizenAfter: initial.citizenTrack, philosophyAfter: initial.philosophyTokens, philosophyTokensToSpend: 0 }
    : payDiceCitizenCost(initial.citizenTrack, initial.philosophyTokens, assignment.citizenCost);
  if (!dicePayment) return null;

  const replay = cloneState(initial);
  if (!options.citizenCostsAlreadyPaid) {
    replay.citizenTrack = dicePayment.citizenAfter;
    replay.philosophyTokens = dicePayment.philosophyAfter;
  }
  for (const choice of choices) {
    const ok = applyAction(replay, choice, cardIds, allCards, opponents, (id) => {
      const idx = cardIds.indexOf(id);
      return idx >= 0 && hasMaskBit(replay.playedMask, idx);
    });
    if (!ok) return null;
  }
  return {
    choices,
    state: replay,
    diceAssignments: assignment.assignments,
    citizenCost: assignment.citizenCost,
    philosophyTokensToSpend: dicePayment.philosophyTokensToSpend,
  };
}

function payDiceCitizenCost(
  citizenTrack: number,
  philosophyTokens: number,
  citizenCost: number,
): { citizenAfter: number; philosophyAfter: number; philosophyTokensToSpend: number } | null {
  if (citizenCost <= citizenTrack) {
    return { citizenAfter: citizenTrack - citizenCost, philosophyAfter: philosophyTokens, philosophyTokensToSpend: 0 };
  }
  for (let tokensToSpend = 1; tokensToSpend <= philosophyTokens; tokensToSpend++) {
    const boostedCitizens = Math.min(15, citizenTrack + tokensToSpend * 3);
    if (boostedCitizens < citizenCost) continue;
    return {
      citizenAfter: boostedCitizens - citizenCost,
      philosophyAfter: philosophyTokens - tokensToSpend,
      philosophyTokensToSpend: tokensToSpend,
    };
  }
  return null;
}

function chooseDiceAssignment(
  choices: ActionChoice[],
  options: ActionEnumerationOptions,
  existingAssignments: SolverDiceAssignment[],
): { assignments: SolverDiceAssignment[]; citizenCost: number } | null {
  if (options.forcedAssignments && options.forcedAssignments.length > 0) {
    const assignments = options.forcedAssignments.slice(0, choices.length);
    if (assignments.length !== choices.length) return null;
    for (let i = 0; i < choices.length; i++) {
      if (assignments[i].action !== choices[i].type) return null;
    }
    const citizenCost = options.citizenCostsAlreadyPaid
      ? 0
      : assignments.reduce((sum, a) => sum + a.citizenCost, 0);
    return { assignments, citizenCost };
  }

  const dice = options.diceRoll ?? null;
  if (!dice || dice.length === 0) {
    return { assignments: existingAssignments, citizenCost: 0 };
  }
  if (choices.length > dice.length) return null;
  return bestDiceAssignment(choices.map(c => c.type), dice);
}

function bestDiceAssignment(
  actions: SolverAction[],
  dice: number[],
): { assignments: SolverDiceAssignment[]; citizenCost: number } | null {
  let best: { assignments: SolverDiceAssignment[]; citizenCost: number } | null = null;
  const used = new Set<number>();
  const current: SolverDiceAssignment[] = [];

  const visit = (index: number, cost: number): void => {
    if (best && cost >= best.citizenCost) return;
    if (index >= actions.length) {
      best = { assignments: [...current], citizenCost: cost };
      return;
    }
    const action = actions[index];
    for (let i = 0; i < dice.length; i++) {
      if (used.has(i)) continue;
      const dieValue = dice[i];
      const citizenCost = Math.max(0, actionNumber(action) - dieValue);
      used.add(i);
      current.push({ action, dieValue, citizenCost });
      visit(index + 1, cost + citizenCost);
      current.pop();
      used.delete(i);
    }
  };

  visit(0, 0);
  return best;
}

/** Cheap heuristic: estimate state value for ranking action candidates. */
export function heuristicScore(s: SolverState, cardIds?: string[]): number {
  // Weight roughly by expected VP contribution over the remaining game.
  const roundsLeft = Math.max(0, 9 - s.round + 1);
  const minors = s.knowledge.greenMinor + s.knowledge.blueMinor + s.knowledge.redMinor;
  const majors = majorCount(s);

  // Tax grants drachma in future tax phases, but it is easy to overvalue late:
  // unspent coins do not score. Count only remaining future collections and
  // discount hard as the game approaches its final scoring turn.
  const futureTaxCollections = Math.max(0, roundsLeft - 1);
  const taxConversion = roundsLeft <= 2 ? 0.35 : roundsLeft <= 4 ? 0.65 : 0.85;
  const taxVP = s.taxTrack * futureTaxCollections * taxConversion;

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

  // Hand cards: generic draw flexibility plus card-specific cash-out potential.
  // The specific potential is deliberately below the played value: a premium card in
  // hand should be worth something, but converting it before the game ends must
  // still read as a real improvement to the search.
  const handCount = s.handSlots;
  const playedCount = popcount(s.playedMask);
  const perHandLatent = roundsLeft >= 4 ? 3.2 : roundsLeft >= 2 ? 2.0 : 0.8;
  const handLatent = Math.min(handCount, roundsLeft) * perHandLatent;
  const handCashoutPotential = cardIds
    ? unplayedHandCashoutPotential(s, cardIds, roundsLeft)
    : 0;

  // Played cards: generic ongoing-bonus accrual for non-endgame cards. End-game
  // cards are scored by their actual current formula below; adding a generic
  // played-card premium on top of that overvalues cards such as Proskenion
  // when the citizen track is still low.
  const playedNonEndGameCount = cardIds
    ? countPlayedNonEndGameCards(s, cardIds)
    : playedCount;
  const playedVal = playedNonEndGameCount * (1.0 + 0.8 * roundsLeft);

  // Played cards end-game VP: for cards with explicit endgame scoring (bank, austerity,
  // central-government, hall-of-statues, gold-reserve, heavy-taxes, proskenion,
  // diversification), score the anticipated endgame VP directly using the current state.
  let playedEndGameVP = 0;
  if (cardIds) {
    for (let i = 0; i < cardIds.length; i++) {
      if (!hasMaskBit(s.playedMask, i)) continue;
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
    handCashoutPotential +
    playedVal +
    playedEndGameVP
  );
}

function choicePriorityBonus(
  before: SolverState,
  after: SolverState,
  choice: ActionChoice,
  cardIds: string[],
): number {
  if (choice.type !== 'POLITICS') return 0;
  const cardId = cardIds[choice.cardIndex];
  if (!cardId) return 0;
  const roundsLeft = Math.max(0, 9 - before.round + 1);
  const cashout = politicsCardCashoutPotential(cardId, after, true);
  const immediateVP = Math.max(0, after.victoryPoints - before.victoryPoints);
  const urgency = roundsLeft <= 1 ? 4.0 : roundsLeft <= 2 ? 3.0 : roundsLeft <= 4 ? 1.8 : 0.8;
  const highValueBonus = Math.min(34, cashout * urgency * 0.75);
  const conversionBonus = cashout >= 6
    ? Math.min(
        roundsLeft <= 2 ? 22 : roundsLeft <= 4 ? 16 : 10,
        cashout * (roundsLeft <= 2 ? 1.25 : roundsLeft <= 4 ? 0.9 : 0.55),
      )
    : 0;
  const tacticalBonus = tacticalPoliticsPriority(cardId, after, roundsLeft);
  return highValueBonus + conversionBonus + tacticalBonus + Math.min(10, immediateVP * 0.7);
}

function tacticalPoliticsPriority(cardId: string, s: SolverState, roundsLeft: number): number {
  const lateCashout = roundsLeft <= 2 ? 10 : roundsLeft <= 4 ? 6 : 0;
  switch (cardId) {
    case 'colossus-of-rhodes': return 16 + lateCashout;
    case 'central-government': return Math.min(28, 8 + popcount(s.playedMask) * 1.6) + lateCashout;
    case 'hall-of-statues': return Math.min(22, 5 + totalKnowledge(s) * 1.4) + lateCashout;
    case 'tunnel-of-eupalinos': return 11 + lateCashout;
    case 'gold-reserve': return Math.min(20, s.economyTrack * 1.6) + lateCashout;
    case 'heavy-taxes': return Math.min(18, s.taxTrack * 1.5) + lateCashout;
    case 'diversification': return Math.min(18, Math.min(s.economyTrack, s.cultureTrack, s.militaryTrack) * 2.4) + lateCashout;
    case 'proskenion': return Math.min(18, s.citizenTrack * 1.5) + lateCashout;
    case 'bank': return Math.min(16, Math.floor(s.coins / 2)) + lateCashout;
    default: return isEndGameCardId(cardId) ? 5 + lateCashout : 0;
  }
}

function unplayedHandCashoutPotential(
  s: SolverState,
  cardIds: string[],
  roundsLeft: number,
): number {
  let total = 0;
  const latentFactor = roundsLeft <= 1 ? 0.03 : roundsLeft <= 2 ? 0.08 : roundsLeft <= 4 ? 0.18 : 0.30;
  const reserveFactor = roundsLeft <= 1 ? 0.55 : roundsLeft <= 2 ? 0.46 : roundsLeft <= 4 ? 0.34 : 0.20;
  const latePenaltyFactor = roundsLeft <= 1 ? 0.24 : roundsLeft <= 2 ? 0.16 : roundsLeft <= 4 ? 0.06 : 0;

  for (let i = 0; i < cardIds.length; i++) {
    if (!hasMaskBit(s.handMask, i)) continue;
    const cardId = cardIds[i];
    const cashout = politicsCardCashoutPotential(cardId, s, false);
    if (cashout <= 0) continue;
    total += cashout * latentFactor;

    const cost = politicsCardCashoutCost(cardId);
    if (cost > 0 && cashout >= cost) {
      const reserveProgress = Math.min(s.coins, cost) / cost;
      total += Math.min(cashout, 14) * reserveProgress * reserveFactor;
      if (s.coins < cost) {
        const shortfall = cost - s.coins;
        total -= Math.min(5, shortfall * latePenaltyFactor * 1.8);
      }
    }

    if (latePenaltyFactor > 0 && cashout >= 6) {
      total -= Math.min(4, cashout * latePenaltyFactor);
    }
  }

  return total;
}

function politicsCardCashoutPotential(
  cardId: string,
  s: SolverState,
  alreadyPlayed: boolean,
): number {
  if (isEndGameCardId(cardId)) {
    if (cardId === 'central-government' && !alreadyPlayed) {
      return (popcount(s.playedMask) + 1) * 2;
    }
    return endGameCardVP(cardId, s);
  }

  switch (cardId) {
    case 'colossus-of-rhodes': return 10;
    case 'tunnel-of-eupalinos': return 6;
    case 'silver-mining': return Math.min(12, Math.max(2, 2 * Math.max(1, 9 - s.round + 1) * 0.95));
    case 'quarry': return Math.min(6, Math.max(1, Math.max(1, 9 - s.round + 1) * 0.95));
    case 'gold-reserve': return s.economyTrack * 2;
    case 'peripteros': return 4;
    case 'reformists': return Math.max(3, Math.max(0, 9 - s.round + 1) * 2.2);
    case 'lighthouse': return Math.max(3, Math.max(0, 9 - s.round + 1) * 1.6);
    case 'constructing-the-mint': return Math.max(2, Math.max(0, 9 - s.round + 1) * 1.5);
    case 'diolkos': return Math.max(2, Math.max(0, 9 - s.round + 1) * 1.4);
    case 'oracle': return 4 + Math.max(0, 4 - s.developmentLevel) * 2;
    default: return 0;
  }
}

function politicsCardCashoutCost(cardId: string): number {
  switch (cardId) {
    case 'austerity': return 6;
    case 'central-government': return 4;
    case 'gold-reserve': return 8;
    case 'heavy-taxes': return 4;
    case 'hall-of-statues': return 2;
    case 'colossus-of-rhodes': return 6;
    case 'diversification': return 6;
    case 'tunnel-of-eupalinos': return 4;
    case 'oracle': return 3;
    case 'public-market': return 3;
    case 'founding-the-lyceum': return 3;
    case 'ostracism': return 3;
    case 'silver-mining': return 3;
    case 'amnesty-for-socrates': return 2;
    case 'foreign-supplies': return 2;
    case 'stadion': return 2;
    case 'constructing-the-mint': return 2;
    case 'scholarly-welcome': return 2;
    case 'archives': return 2;
    case 'lighthouse': return 1;
    case 'helepole': return 1;
    case 'peripteros': return 1;
    case 'bank': return 0;
    case 'proskenion': return 0;
    case 'stoa-poikile': return 0;
    case 'persians': return 0;
    case 'extraordinary-collection': return 0;
    case 'diolkos': return 0;
    case 'corinthian-columns': return 0;
    case 'gradualism': return 0;
    case 'old-guard': return 0;
    case 'power': return 0;
    case 'reformists': return 0;
    case 'rivalry': return 0;
    case 'quarry': return 0;
    case 'contribution': return 0;
    case 'gifts-from-the-west': return 0;
    case 'council': return 0;
    case 'mercenary-recruitment': return 0;
    case 'greek-fire': return 0;
    default: return 0;
  }
}

function countPlayedNonEndGameCards(s: SolverState, cardIds: string[]): number {
  let count = 0;
  for (let i = 0; i < cardIds.length; i++) {
    if (!hasMaskBit(s.playedMask, i)) continue;
    if (isEndGameCardId(cardIds[i])) continue;
    count++;
  }
  return count;
}

function isEndGameCardId(cardId: string): boolean {
  return cardId === 'bank'
    || cardId === 'austerity'
    || cardId === 'proskenion'
    || cardId === 'diversification'
    || cardId === 'central-government'
    || cardId === 'gold-reserve'
    || cardId === 'heavy-taxes'
    || cardId === 'hall-of-statues';
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
