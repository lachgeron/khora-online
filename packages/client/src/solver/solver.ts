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
import { cloneState, popcount } from './card-data';
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
    slotsConsumedThisRound: input.slotsConsumedThisRound,
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
 * Simulate one round starting from state `s`. Returns top-K round outcomes
 * (for multi-round beam search). Results are sorted best-first by heuristic.
 */
function simulateRoundTopK(
  s: SolverState,
  ctx: SolverContext,
  topK: number,
): RoundResult[] {
  if (Date.now() >= ctx.deadline) return [];

  const vpBefore = s.victoryPoints;
  const coinsBefore = s.coins;

  // 1. Action phase: enumerate action plans for remaining slots.
  const maxSlots = s.cultureTrack >= 4 ? 3 : 2;
  const slotsLeft = Math.max(0, maxSlots - s.slotsConsumedThisRound);
  const actionPlans = enumerateActionPlans(
    s,
    slotsLeft,
    ctx.cardIds,
    ctx.allCards,
    ctx.opponents,
    ctx.actionTopK,
  );
  ctx.nodesExplored.count += actionPlans.length;

  const scored: Array<{ score: number; result: RoundResult }> = [];

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
      const progressTracks = diffProgressTracks(ap.state, pState);
      const philosophySpent = ap.state.philosophyTokens - pState.philosophyTokens;
      scored.push({
        score,
        result: {
          stateAfter: afterTax,
          chosenActions: ap.choices,
          progressTracks,
          philosophySpent,
          description: describeRound(
            ap.choices,
            progressTracks,
            philosophySpent,
            ctx.cardIds,
            ctx.allCards,
            hasCard(pState, 'old-guard', ctx.cardIds),
          ),
          vpBefore,
          vpAfter: afterTax.victoryPoints,
          coinsBefore,
          coinsAfter: afterTax.coins,
        },
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(x => x.result);
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
  hasOldGuard: boolean,
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
    bullets.push(hasOldGuard ? 'Progress: skip (Old Guard +4 VP)' : 'Progress: skip (nothing affordable)');
  }
  return bullets;
}

function describeChoice(
  c: ActionChoice,
  cardIds: string[],
  allCards: PoliticsCard[],
): string {
  switch (c.type) {
    case 'PHILOSOPHY': return 'Philosophy — gain 1 scroll';
    case 'CULTURE':    return 'Culture — gain VP';
    case 'TRADE':      return c.buyMinor
      ? `Trade — gain coins, buy a ${c.buyMinor} minor token`
      : 'Trade — gain coins';
    case 'MILITARY': {
      const list = c.explore.map(t => `${t.color} ${t.tokenType.toLowerCase()}`).join(', ');
      return `Military — gain troops${c.explore.length ? `, explore ${list}` : ''}`;
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
  next.slotsConsumedThisRound = 0;
  next.progressAlreadyDone = false;
  return next;
}

// ─── Diversity-preserving beam selection ────────────────────────────────────

/**
 * Select up to `beamWidth` entries from a sorted list while preserving
 * strategic diversity. Bucketing by (developmentLevel, cultureTrack>=4 flag,
 * majorsTier) prevents the beam from collapsing into a single near-identical
 * trajectory (e.g. 12 Old-Guard-spam variants) and keeps Dev-investment paths
 * alive even when their current score lags.
 */
function diversifyBeam<T extends { state: SolverState }>(
  sortedDesc: T[],
  beamWidth: number,
): T[] {
  if (sortedDesc.length <= beamWidth) return sortedDesc;

  const majorsTier = (s: SolverState): number => {
    const m = s.knowledge.greenMajor + s.knowledge.blueMajor + s.knowledge.redMajor;
    if (m >= 3) return 3;
    if (m >= 2) return 2;
    if (m >= 1) return 1;
    return 0;
  };
  const bucketKey = (s: SolverState): string => {
    const devCap = Math.min(s.developmentLevel, 4);
    const cult4 = s.cultureTrack >= 4 ? 1 : 0;
    const mt = majorsTier(s);
    const playedT = Math.min(popcount(s.playedMask), 6);
    return `${devCap}-${cult4}-${mt}-${playedT}`;
  };

  const seenBuckets = new Set<string>();
  const chosen: T[] = [];
  // First pass: take the best entry from each distinct bucket.
  for (const entry of sortedDesc) {
    if (chosen.length >= beamWidth) break;
    const key = bucketKey(entry.state);
    if (seenBuckets.has(key)) continue;
    seenBuckets.add(key);
    chosen.push(entry);
  }
  // Second pass: fill remaining slots from the overall top ranking.
  if (chosen.length < beamWidth) {
    const chosenSet = new Set(chosen);
    for (const entry of sortedDesc) {
      if (chosen.length >= beamWidth) break;
      if (chosenSet.has(entry)) continue;
      chosen.push(entry);
    }
  }
  return chosen;
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

  interface BeamEntry {
    state: SolverState;
    roundPlans: RoundPlan[];
  }

  const nodesExploredShared = { count: 0 };
  const partialResultShared = { value: false };

  /**
   * Deterministic small-magnitude jitter for ranking diversity in restart passes.
   * Returns a value in roughly [-1.5, 1.5] derived from a cheap state-fingerprint
   * XOR'd with the seed. When seed=0 the jitter is 0 (pure heuristic ordering).
   */
  const rankJitter = (s: SolverState, seed: number): number => {
    if (seed === 0) return 0;
    let h = seed * 2654435761;
    h ^= s.handMask | 0;
    h ^= (s.playedMask | 0) * 31;
    h ^= (s.victoryPoints | 0) * 97;
    h ^= (s.coins | 0) * 131;
    h ^= (s.economyTrack | 0) * 7 + (s.cultureTrack | 0) * 11 + (s.militaryTrack | 0) * 13;
    h ^= (s.developmentLevel | 0) * 17 + (s.philosophyTokens | 0) * 19 + (s.troopTrack | 0) * 23;
    h = (h ^ (h >>> 16)) >>> 0;
    // Normalize to ~[-1.5, 1.5]
    return ((h / 0xffffffff) - 0.5) * 3;
  };

  /** Run a full 9-round beam search with the given widths. Returns best trajectory or null if time runs out. */
  const runBeam = (beamWidth: number, actionTopK: number, seed: number = 0): BeamEntry | null => {
    const ctx: SolverContext = {
      cardIds,
      allCards: allCardObjs,
      opponents: input.opponents,
      deadline,
      nodesExplored: nodesExploredShared,
      partialResult: partialResultShared,
      beamWidth,
      actionTopK,
    };

    let beam: BeamEntry[] = [{ state: initialState, roundPlans: [] }];

    for (let round = initialState.round; round <= 9; round++) {
      if (Date.now() >= deadline) {
        partialResultShared.value = true;
        return null;
      }
      const nextBeam: BeamEntry[] = [];
      for (const entry of beam) {
        if (Date.now() >= deadline) { partialResultShared.value = true; break; }
        const stateAtRound = { ...entry.state, round };
        const results = simulateRoundTopK(stateAtRound, ctx, beamWidth);
        for (const r of results) {
          nextBeam.push({
            state: advanceToNextRound(r.stateAfter),
            roundPlans: [
              ...entry.roundPlans,
              {
                round,
                description: r.description,
                vpBefore: r.vpBefore,
                vpAfter: r.vpAfter,
                coinsBefore: r.coinsBefore,
                coinsAfter: r.coinsAfter,
              },
            ],
          });
        }
      }
      if (nextBeam.length === 0) {
        partialResultShared.value = true;
        return null;
      }
      // Rank by forward-looking heuristic (captures future-potential, not just current score).
      // In restart passes (seed!=0) a tiny deterministic jitter is added so ties and
      // near-ties break differently, exposing trajectories the main beam pruned.
      nextBeam.sort((a, b) =>
        (heuristicScore(b.state) + rankJitter(b.state, seed)) -
        (heuristicScore(a.state) + rankJitter(a.state, seed))
      );
      // Diversity-preserving selection: bucket by (devLevel, cultureTrack>=4, majorCount>=2) to
      // keep strategic variety. Within each bucket, take the best; then fill the remaining slots
      // from the overall ranking.
      beam = diversifyBeam(nextBeam, beamWidth);
    }

    // Pick best by actual final VP.
    let best: BeamEntry | null = null;
    let bestScore = -Infinity;
    for (const entry of beam) {
      const sc = finalizeScore(entry.state, cardIds, allCardObjs).total;
      if (sc > bestScore) { bestScore = sc; best = entry; }
    }
    return best;
  };

  // Iterative deepening: run beam search with progressively wider parameters
  // until we hit the deadline. Keep the best trajectory found so far.
  let overallBest: BeamEntry | null = null;
  let overallBestVP = -Infinity;

  // Wide schedule that scales up well beyond what can typically finish — the
  // deadline check inside `runBeam` is the real terminator. If a pass hits the
  // deadline mid-search it returns null and we stop, keeping the best trajectory
  // from earlier (fully-completed) passes.
  const widths: Array<[number, number]> = [
    [12, 12],
    [24, 16],
    [48, 20],
    [80, 24],
    [120, 28],
    [200, 32],
    [320, 36],
    [500, 40],
    [800, 44],
    [1200, 48],
    [2000, 52],
  ];
  for (const [beamWidth, actionTopK] of widths) {
    if (Date.now() >= deadline) break;
    const result = runBeam(beamWidth, actionTopK);
    if (!result) break;
    const vp = finalizeScore(result.state, cardIds, allCardObjs).total;
    if (vp > overallBestVP) {
      overallBestVP = vp;
      overallBest = result;
    }
  }

  // Randomized restarts: use remaining budget to search with small ranking noise,
  // which breaks ties differently and explores trajectories the main beam pruned.
  let restartSeed = 1;
  while (Date.now() < deadline - 500) {
    // Budget at least ~500ms for end-of-run bookkeeping.
    const result = runBeam(200, 32, restartSeed);
    restartSeed++;
    if (!result) break;
    const vp = finalizeScore(result.state, cardIds, allCardObjs).total;
    if (vp > overallBestVP) {
      overallBestVP = vp;
      overallBest = result;
    }
  }

  if (!overallBest) {
    // Fallback: if we couldn't complete any beam (e.g., deadline hit immediately), return empty plan.
    overallBest = { state: initialState, roundPlans: [] };
  }

  const finalState = overallBest.state;
  const roundPlans = overallBest.roundPlans;
  const finalized = finalizeScore(finalState, cardIds, allCardObjs);

  const currentRound = roundPlans.length > 0 ? roundPlans[0] : null;
  const futureRounds = roundPlans.slice(1);

  const plan: Plan = {
    projectedFinalVP: finalized.total,
    vpBreakdown: finalized.breakdown,
    currentRound,
    futureRounds,
    partialResult: partialResultShared.value,
    computeMs: Date.now() - start,
    exploredNodes: nodesExploredShared.count,
  };

  return { ok: true, plan };
}
