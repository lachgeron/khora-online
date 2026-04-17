/**
 * Main solver entry point.
 *
 * Uses beam-search over macro-actions per round. Budget enforced by wall clock.
 * Returns best plan found before timeout (partialResult flag if incomplete).
 */

import type {
  SolverState,
  SolverInput,
  SolverResult,
  Plan,
  RoundPlan,
  FrozenOpponent,
  ActionChoice,
} from './types';
import type { PoliticsCard, ProgressTrackType } from '../types';
import { enumerateActionPlans, heuristicScore } from './action-enum';
import { enumerateProgressPlans } from './progress-enum';
import { applyTaxPhase, finalizeScore } from './scoring';
import { cloneState } from './card-data';
import { canSolveFromPhase } from './snapshot';
import type { PublicGameState } from '../types';

// ─── Setup: build cardIds/allCards list and initial state ───────────────────

interface SolverContext {
  cardIds: string[];
  allCards: PoliticsCard[];
  opponents: FrozenOpponent[];
  deadline: number;
  nodesExplored: { count: number };
  partialResult: { value: boolean };
  beamWidth: number;
  actionTopK: number;
}

function buildInitialState(input: SolverInput, cardIds: string[]): SolverState {
  const knowledge = {
    greenMinor: 0, blueMinor: 0, redMinor: 0,
    greenMajor: 0, blueMajor: 0, redMajor: 0,
  };
  for (const t of input.knowledgeTokens) {
    if (t.tokenType === 'MAJOR') {
      if (t.color === 'GREEN') knowledge.greenMajor++;
      else if (t.color === 'BLUE') knowledge.blueMajor++;
      else knowledge.redMajor++;
    } else {
      if (t.color === 'GREEN') knowledge.greenMinor++;
      else if (t.color === 'BLUE') knowledge.blueMinor++;
      else knowledge.redMinor++;
    }
  }

  let handMask = 0;
  let playedMask = 0;
  for (const c of input.handCards) {
    const idx = cardIds.indexOf(c.id);
    if (idx >= 0) handMask |= 1 << idx;
  }
  for (const c of input.playedCards) {
    const idx = cardIds.indexOf(c.id);
    if (idx >= 0) playedMask |= 1 << idx;
  }

  return {
    round: input.currentRound,
    actionsAlreadyTaken: [...input.actionsAlreadyTaken],
    progressAlreadyDone: input.progressAlreadyDone,
    economyTrack: input.economyTrack,
    cultureTrack: input.cultureTrack,
    militaryTrack: input.militaryTrack,
    taxTrack: input.taxTrack,
    gloryTrack: input.gloryTrack,
    troopTrack: input.troopTrack,
    citizenTrack: input.citizenTrack,
    coins: input.coins,
    philosophyTokens: input.philosophyTokens,
    knowledge,
    cityId: input.cityId,
    developmentLevel: input.developmentLevel,
    handMask,
    playedMask,
    victoryPoints: input.victoryPoints,
  };
}

// ─── Round simulation ────────────────────────────────────────────────────────

interface RoundResult {
  stateAfter: SolverState;
  chosenActions: ActionChoice[];
  progressTracks: ProgressTrackType[];
  philosophySpent: number;
  description: string[];
  vpBefore: number;
  vpAfter: number;
  coinsBefore: number;
  coinsAfter: number;
}

/**
 * Simulate one round starting from state `s` (mid-round or fresh). Returns the
 * best round outcome (state + chosen actions/progress/etc.).
 */
function simulateRound(
  s: SolverState,
  ctx: SolverContext,
  _depth: number,
): RoundResult | null {
  if (Date.now() >= ctx.deadline) return null;

  const vpBefore = s.victoryPoints;
  const coinsBefore = s.coins;

  // 1. Action phase: enumerate action plans for remaining slots.
  const slotsLeft = 3 - s.actionsAlreadyTaken.length;
  const actionPlans = enumerateActionPlans(
    s,
    slotsLeft,
    ctx.cardIds,
    ctx.allCards,
    ctx.opponents,
    ctx.actionTopK,
  );
  ctx.nodesExplored.count += actionPlans.length;

  // 2. For each action plan, enumerate progress plans.
  let bestTotal = -Infinity;
  let best: RoundResult | null = null;

  for (const ap of actionPlans) {
    if (Date.now() >= ctx.deadline) { ctx.partialResult.value = true; break; }
    const progressCandidates = enumerateProgressPlans(
      ap.state,
      ctx.opponents,
      (id) => hasCard(ap.state, id, ctx.cardIds),
      (id) => devUnlocked(ap.state, id),
    );
    ctx.nodesExplored.count += progressCandidates.length;

    for (const pState of progressCandidates) {
      const afterTax = cloneState(pState);
      applyTaxPhase(afterTax, ctx.opponents, (id) => hasCard(afterTax, id, ctx.cardIds));
      const score = heuristicScore(afterTax);
      if (score > bestTotal) {
        bestTotal = score;
        // Reconstruct the progress tracks used (by diff).
        const progressTracks = diffProgressTracks(ap.state, pState);
        const philosophySpent = ap.state.philosophyTokens - pState.philosophyTokens;
        best = {
          stateAfter: afterTax,
          chosenActions: ap.choices,
          progressTracks,
          philosophySpent,
          description: describeRound(ap.choices, progressTracks, philosophySpent, ctx.cardIds, ctx.allCards),
          vpBefore,
          vpAfter: afterTax.victoryPoints,
          coinsBefore,
          coinsAfter: afterTax.coins,
        };
      }
    }
  }

  return best;
}

function hasCard(s: SolverState, id: string, cardIds: string[]): boolean {
  const idx = cardIds.indexOf(id);
  return idx >= 0 && (s.playedMask & (1 << idx)) !== 0;
}

function devUnlocked(s: SolverState, id: string): boolean {
  // Simplified: if devId ends with "-dev-N" and s.developmentLevel >= N and s.cityId matches prefix
  const m = /^([a-z]+)-dev-(\d)$/.exec(id);
  if (!m) return false;
  const city = m[1];
  const n = parseInt(m[2], 10);
  return s.cityId === city && s.developmentLevel >= n;
}

function diffProgressTracks(before: SolverState, after: SolverState): ProgressTrackType[] {
  const diffs: ProgressTrackType[] = [];
  const e = after.economyTrack - before.economyTrack;
  const c = after.cultureTrack - before.cultureTrack;
  const m = after.militaryTrack - before.militaryTrack;
  for (let i = 0; i < e; i++) diffs.push('ECONOMY');
  for (let i = 0; i < c; i++) diffs.push('CULTURE');
  for (let i = 0; i < m; i++) diffs.push('MILITARY');
  return diffs;
}

function describeRound(
  choices: ActionChoice[],
  progressTracks: ProgressTrackType[],
  philosophySpent: number,
  cardIds: string[],
  allCards: PoliticsCard[],
): string[] {
  const bullets: string[] = [];
  for (const c of choices) {
    bullets.push(describeChoice(c, cardIds, allCards));
  }
  if (progressTracks.length > 0) {
    const counts = { ECONOMY: 0, CULTURE: 0, MILITARY: 0 };
    for (const t of progressTracks) counts[t]++;
    const parts: string[] = [];
    if (counts.ECONOMY) parts.push(`+${counts.ECONOMY} Economy`);
    if (counts.CULTURE) parts.push(`+${counts.CULTURE} Culture`);
    if (counts.MILITARY) parts.push(`+${counts.MILITARY} Military`);
    let msg = `Progress: ${parts.join(', ')}`;
    if (philosophySpent > 0) msg += ` (spent ${philosophySpent} scrolls)`;
    bullets.push(msg);
  } else {
    bullets.push('Progress: skip (Old Guard +4 VP)');
  }
  return bullets;
}

function describeChoice(
  c: ActionChoice,
  cardIds: string[],
  allCards: PoliticsCard[],
): string {
  switch (c.type) {
    case 'PHILOSOPHY': return 'Philosophy — gain 2 scrolls';
    case 'CULTURE':    return 'Culture — gain coins';
    case 'TRADE':      return c.buyMinor
      ? `Trade — buy a ${c.buyMinor} minor token`
      : 'Trade — gain coins';
    case 'MILITARY': {
      const list = c.explore.map(t => `${t.color} ${t.tokenType.toLowerCase()}`).join(', ');
      return `Military — explore ${list || 'nothing'}`;
    }
    case 'POLITICS': {
      const card = allCards[c.cardIndex];
      const name = card?.name ?? cardIds[c.cardIndex] ?? '?';
      return `Politics — play "${name}"${c.philosophyPairs ? ` (+${c.philosophyPairs * 2} scrolls)` : ''}`;
    }
    case 'DEVELOPMENT': return `Development — unlock next level${c.philosophyPairs ? ` (+${c.philosophyPairs * 2} scrolls)` : ''}`;
  }
}

/** Transition state to next round: reset mid-round flags, increment round. */
function advanceToNextRound(s: SolverState): SolverState {
  const next = cloneState(s);
  next.round += 1;
  next.actionsAlreadyTaken = [];
  next.progressAlreadyDone = false;
  return next;
}

// ─── Entry point ────────────────────────────────────────────────────────────

export function runSolver(
  input: SolverInput,
  publicState: PublicGameState,
  options: { timeoutMs: number } = { timeoutMs: 25000 },
): SolverResult {
  const phaseCheck = canSolveFromPhase(publicState);
  if (!phaseCheck.ok) {
    return { ok: false, reason: phaseCheck.reason!, message: phaseCheck.message ?? 'Unavailable' };
  }

  const start = Date.now();
  const deadline = start + options.timeoutMs;

  // Build card index table
  const allCardObjs = [...input.handCards, ...input.playedCards];
  const cardIds = allCardObjs.map(c => c.id);

  const initialState = buildInitialState(input, cardIds);
  const ctx: SolverContext = {
    cardIds,
    allCards: allCardObjs,
    opponents: input.opponents,
    deadline,
    nodesExplored: { count: 0 },
    partialResult: { value: false },
    beamWidth: 4,
    actionTopK: 4,
  };

  const roundPlans: RoundPlan[] = [];
  let state = initialState;

  // Greedy round-by-round simulation
  for (let round = initialState.round; round <= 9; round++) {
    if (Date.now() >= deadline) {
      ctx.partialResult.value = true;
      break;
    }
    state = { ...state, round };
    const result = simulateRound(state, ctx, 0);
    if (!result) {
      ctx.partialResult.value = true;
      break;
    }
    roundPlans.push({
      round,
      description: result.description,
      vpBefore: result.vpBefore,
      vpAfter: result.vpAfter,
      coinsBefore: result.coinsBefore,
      coinsAfter: result.coinsAfter,
    });
    state = advanceToNextRound(result.stateAfter);
  }

  const finalized = finalizeScore(state, cardIds, allCardObjs);

  const currentRound = roundPlans.length > 0 ? roundPlans[0] : null;
  const futureRounds = roundPlans.slice(1);

  const plan: Plan = {
    projectedFinalVP: finalized.total,
    vpBreakdown: finalized.breakdown,
    currentRound,
    futureRounds,
    partialResult: ctx.partialResult.value,
    computeMs: Date.now() - start,
    exploredNodes: ctx.nodesExplored.count,
  };

  return { ok: true, plan };
}
