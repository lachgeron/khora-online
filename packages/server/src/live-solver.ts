import type {
  ActionChoices,
  ActionType,
  ClientMessage,
  DecisionType,
  GamePhase,
  GameState,
  KnowledgeColor,
  KnowledgeRequirement,
  KnowledgeToken,
  LiveSolverMove,
  LiveSolverReferenceLine,
  LiveSolverResult,
  LiveSolverRoundPlan,
  LiveSolverScoreProjection,
  PlayerState,
  PoliticsCard,
  ProgressTrackType,
} from '@khora/shared';
import { ACTION_NUMBERS } from '@khora/shared';
import { GameEngine } from './game-engine';
import { getAllCityCards } from './game-data';
import { calculateFinalScores } from './scoring-engine';
import { activateDev, calculateDevEndGameScore, getActivatableDevs, hasDevUnlocked } from './city-dev-handlers';
import { advanceTrack } from './resources';

interface SearchOptions {
  timeBudgetMs: number;
  beamWidth: number;
  targetBranches: number;
  opponentBranches: number;
  completionWidth: number;
  maxDecisionPlies: number;
  exactTimeBudgetMs: number;
  exactNodeLimit: number;
  progressIntervalMs: number;
  skipExactSearch: boolean;
  referenceLines: LiveSolverReferenceLine[];
  referenceLineWeight: number;
}

interface Candidate {
  message: ClientMessage;
  instruction: string;
  detail: string;
  estimatedSeconds: number;
  quickScore: number;
}

interface SearchNode {
  state: GameState;
  moves: LiveSolverMove[];
  score: number;
}

interface Projection {
  scores: LiveSolverScoreProjection[];
  margin: number | null;
}

interface ExactSearchContext {
  targetPlayerId: string;
  startMs: number;
  deadlineMs: number;
  nodeLimit: number;
  nodes: number;
  cacheHits: number;
  cache: Map<string, ExactCacheEntry>;
}

interface ExactCacheEntry {
  score: number;
  node: SearchNode;
  proven: boolean;
}

interface ExactSearchResult {
  score: number;
  node: SearchNode;
  proven: boolean;
  reason: string;
  nodes: number;
  cacheHits: number;
}

interface ReferenceMovePrior {
  score: number;
  lineCount: number;
  tags: Set<string>;
}

interface ReferenceSearchBook {
  weight: number;
  priors: Map<string, ReferenceMovePrior>;
}

type StrategyProfileId =
  | 'balanced'
  | 'economy_tax'
  | 'old_guard'
  | 'military_glory'
  | 'politics_engine'
  | 'development_rush'
  | 'cash_endgame'
  | 'diversification';

interface StrategyProfile {
  id: StrategyProfileId;
  actionBias: Partial<Record<ActionType, number>>;
  progressBias: Partial<Record<ProgressTrackType, number>>;
  cardBias: Record<string, number>;
  skipProgressBias: number;
  majorTokenBias: number;
  minorTokenBias: number;
  taxBias: number;
  gloryBias: number;
}

const DEFAULT_OPTIONS: SearchOptions = {
  timeBudgetMs: 8000,
  beamWidth: 128,
  targetBranches: 32,
  opponentBranches: 1,
  completionWidth: 36,
  maxDecisionPlies: 900,
  exactTimeBudgetMs: 5000,
  exactNodeLimit: 500000,
  progressIntervalMs: 1200,
  skipExactSearch: false,
  referenceLines: [],
  referenceLineWeight: 18,
};

const COMPLETION_GRACE_MS = 1600;
const EXACT_PROOF_REASON = 'Optimality proved by exhaustive minimax search with safe pruning.';
const LIGHTWEIGHT_OPPONENT_REASON = 'Opponent continuations use lightweight achievement/event reachability instead of full VP-line branching.';
const COMPETITIVE_TROOP_EVENTS = new Set([
  'origin-of-academy',
  'conscripting-troops',
  'eleusinian-mysteries',
  'military-victory',
  'prosperity',
  'savior-of-greece',
  'thirty-tyrants',
]);
let activeAchievementHorizonRound = 9;
let activeReferenceBook: ReferenceSearchBook | null = null;

const PHASE_ORDER: GamePhase[] = [
  'OMEN',
  'TAXATION',
  'DICE',
  'ACTIONS',
  'PROGRESS',
  'GLORY',
  'ACHIEVEMENT',
];

const PROGRESS_COSTS: Record<ProgressTrackType, Record<number, number>> = {
  ECONOMY: { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 },
  CULTURE: { 1: 1, 2: 4, 3: 6, 4: 6, 5: 7, 6: 7 },
  MILITARY: { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9 },
};

const ACTION_LABELS: Record<ActionType, string> = {
  PHILOSOPHY: 'Philosophy',
  LEGISLATION: 'Legislation',
  CULTURE: 'Culture',
  TRADE: 'Trade',
  MILITARY: 'Military',
  POLITICS: 'Politics',
  DEVELOPMENT: 'Development',
};

const STRATEGY_PROFILES: StrategyProfile[] = [
  {
    id: 'balanced',
    actionBias: { TRADE: 1.2, MILITARY: 1.1, POLITICS: 1.1, DEVELOPMENT: 1, CULTURE: 0.8 },
    progressBias: { ECONOMY: 1.2, CULTURE: 1.1, MILITARY: 1.1 },
    cardBias: { diversification: 8, 'colossus-of-rhodes': 5, bank: 3, proskenion: 3 },
    skipProgressBias: -1,
    majorTokenBias: 1.4,
    minorTokenBias: 0.8,
    taxBias: 1.1,
    gloryBias: 1.1,
  },
  {
    id: 'economy_tax',
    actionBias: { TRADE: 3.2, DEVELOPMENT: 1.4, POLITICS: 1.1, PHILOSOPHY: 0.9 },
    progressBias: { ECONOMY: 4.4, CULTURE: 0.5, MILITARY: 0.2 },
    cardBias: { bank: 9, 'gold-reserve': 8, 'heavy-taxes': 7, 'public-market': 5, 'constructing-the-mint': 8, gradualism: 5, 'silver-mining': 6 },
    skipProgressBias: -3,
    majorTokenBias: 0.6,
    minorTokenBias: 0.9,
    taxBias: 3.2,
    gloryBias: 0.2,
  },
  {
    id: 'old_guard',
    actionBias: { POLITICS: 2.6, TRADE: 1.5, CULTURE: 1.1, MILITARY: 0.8, LEGISLATION: 0.6 },
    progressBias: { ECONOMY: -1.4, CULTURE: -1.2, MILITARY: -1.2 },
    cardBias: { 'old-guard': 16, bank: 5, diversification: 4, proskenion: 5, austerity: 3, 'hall-of-statues': 3 },
    skipProgressBias: 9,
    majorTokenBias: 1.1,
    minorTokenBias: 0.9,
    taxBias: 1.3,
    gloryBias: 0.7,
  },
  {
    id: 'military_glory',
    actionBias: { MILITARY: 4.2, TRADE: 1.5, POLITICS: 1.1, CULTURE: 0.9, DEVELOPMENT: 1 },
    progressBias: { MILITARY: 4.2, ECONOMY: 1.2, CULTURE: 0.4 },
    cardBias: { 'greek-fire': 7, 'mercenary-recruitment': 7, helepole: 5, stadion: 4, 'hall-of-statues': 7, diversification: 3 },
    skipProgressBias: -1,
    majorTokenBias: 5,
    minorTokenBias: 0.5,
    taxBias: 0.5,
    gloryBias: 4,
  },
  {
    id: 'politics_engine',
    actionBias: { POLITICS: 4, LEGISLATION: 2.4, TRADE: 1.8, PHILOSOPHY: 1.3, DEVELOPMENT: 1 },
    progressBias: { ECONOMY: 1.3, CULTURE: 1, MILITARY: 0.5 },
    cardBias: {
      'extraordinary-collection': 9,
      council: 8,
      'corinthian-columns': 8,
      reformists: 7,
      oracle: 7,
      'colossus-of-rhodes': 9,
      'tunnel-of-eupalinos': 6,
      'central-government': 8,
    },
    skipProgressBias: -0.5,
    majorTokenBias: 1,
    minorTokenBias: 1.2,
    taxBias: 1,
    gloryBias: 1,
  },
  {
    id: 'development_rush',
    actionBias: { DEVELOPMENT: 5, TRADE: 2.2, PHILOSOPHY: 1.7, MILITARY: 0.9, POLITICS: 0.8 },
    progressBias: { ECONOMY: 1.3, CULTURE: 1.1, MILITARY: 1.1 },
    cardBias: { oracle: 11, reformists: 5, gradualism: 5, diversification: 5, 'constructing-the-mint': 5 },
    skipProgressBias: -2,
    majorTokenBias: 1.2,
    minorTokenBias: 1.4,
    taxBias: 1.1,
    gloryBias: 1.2,
  },
  {
    id: 'cash_endgame',
    actionBias: { TRADE: 4.2, POLITICS: 1.7, LEGISLATION: 1.2, CULTURE: 0.7, MILITARY: 0.5 },
    progressBias: { ECONOMY: 2, CULTURE: 0.4, MILITARY: 0.2 },
    cardBias: { bank: 16, austerity: 8, 'gold-reserve': 8, 'heavy-taxes': 5, 'gifts-from-the-west': 4, contribution: 4 },
    skipProgressBias: 2,
    majorTokenBias: 0.4,
    minorTokenBias: 0.6,
    taxBias: 1.6,
    gloryBias: 0.3,
  },
  {
    id: 'diversification',
    actionBias: { TRADE: 2, MILITARY: 2, CULTURE: 1.6, DEVELOPMENT: 1.4, POLITICS: 1.3 },
    progressBias: { ECONOMY: 2.5, CULTURE: 2.5, MILITARY: 2.5 },
    cardBias: { diversification: 18, reformists: 7, gradualism: 6, 'constructing-the-mint': 6, 'gold-reserve': 4 },
    skipProgressBias: -5,
    majorTokenBias: 1.2,
    minorTokenBias: 0.8,
    taxBias: 1.1,
    gloryBias: 1.1,
  },
];

let activeHeuristicCache: Map<string, number> | null = null;

export function runLiveSolver(
  state: GameState,
  playerId: string,
  requestId: string,
  options: Partial<SearchOptions> = {},
  onProgress?: (result: LiveSolverResult) => void,
): LiveSolverResult {
  const start = Date.now();
  const opts = sanitizeOptions(options);
  const target = state.players.find(p => p.playerId === playerId);

  if (!target) {
    return errorResult(requestId, playerId, start, 'Player not found.');
  }
  if (state.currentPhase === 'CITY_SELECTION' || state.currentPhase === 'DRAFT_POLITICS') {
    return unavailableResult(requestId, playerId, start, 'Live solver starts after city and politics drafting.');
  }
  if (state.currentPhase === 'GAME_OVER') {
    return unavailableResult(requestId, playerId, start, 'Game is already over.');
  }
  activeAchievementHorizonRound = Math.min(9, state.roundNumber + 1);
  activeHeuristicCache = new Map();
  activeReferenceBook = buildReferenceSearchBook(opts.referenceLines, opts.referenceLineWeight);

  let beam: SearchNode[] = [{
    state: cloneGameState(state),
    moves: [],
    score: heuristicScore(state, playerId),
  }];
  let best: SearchNode = beam[0];
  let searchedNodes = 0;
  const completedNodes: SearchNode[] = [];
  const completedSignatures = new Set<string>();
  let lastProgressAt = 0;

  const recordCompleted = (node: SearchNode) => {
    const key = stateSignature(node.state);
    if (completedSignatures.has(key)) return;
    completedSignatures.add(key);
    completedNodes.push(scoreNode(node, playerId));
    emitProgress(true, 'Best full-game line found so far. Search is still running.');
  };

  const bestKnownNode = () => completedNodes.length > 0
    ? completedNodes
        .slice()
        .sort((a, b) => solvedNodeScore(b, playerId) - solvedNodeScore(a, playerId))[0]
    : normalizeNode(best, playerId).node;

  const emitProgress = (force = false, message = 'Best line found so far. Search is still running.') => {
    if (!onProgress) return;
    const now = Date.now();
    if (!force && now - lastProgressAt < opts.progressIntervalMs) return;
    lastProgressAt = now;
    onProgress(buildUnprovenResult({
      requestId,
      playerId,
      start,
      node: bestKnownNode(),
      searchedNodes,
      completedLines: completedNodes.length,
      proofNodes: 0,
      proofReason: opts.skipExactSearch
        ? 'Progressive line search is still running; exact proof is deferred.'
        : 'Progressive line search is still running.',
      message,
    }));
  };

  const portfolioProfiles = rankStrategyProfiles(state, playerId);
  const portfolioDeadline = start + Math.min(Math.max(1200, opts.timeBudgetMs * 0.28), 6000);
  for (const profile of portfolioProfiles) {
    if (Date.now() > portfolioDeadline && completedNodes.length > 0) break;
    const rollout = completeLineToGameOver(
      beam[0],
      playerId,
      opts,
      portfolioDeadline,
      completedNodes.length === 0,
      profile,
    );
    searchedNodes += rollout.searched;
    if (rollout.completed) {
      recordCompleted(rollout.node);
    } else if (rollout.node.score > best.score) {
      best = rollout.node;
    }
    emitProgress();
  }

  for (let step = 0; step < opts.maxDecisionPlies; step++) {
    if (Date.now() - start >= opts.timeBudgetMs) break;

    const nextBeam: SearchNode[] = [];
    let allComplete = true;

    for (const node of beam) {
      if (Date.now() - start >= opts.timeBudgetMs) break;

      const normalized = normalizeNode(node, playerId);
      searchedNodes += normalized.searched;

      if (normalized.node.state.currentPhase === 'GAME_OVER') {
        recordCompleted(normalized.node);
        nextBeam.push(normalized.node);
        continue;
      }

      allComplete = false;
      const decision = pickDecision(normalized.node.state, playerId);
      if (!decision) {
        const advanced = advancePhase(normalized.node.state);
        searchedNodes++;
        nextBeam.push(scoreNode({ ...normalized.node, state: advanced }, playerId));
        continue;
      }

      const actorIsTarget = decision.playerId === playerId;
      const candidates = orderSearchCandidates(
        normalized.node.state,
        decision.playerId,
        decision.decisionType,
        playerId,
        actorIsTarget,
      ).slice(0, actorIsTarget ? opts.targetBranches : opts.opponentBranches);

      const usableCandidates = candidates.length > 0
        ? candidates
        : fallbackCandidates(normalized.node.state, decision.playerId, decision.decisionType);

      for (let candidateIndex = 0; candidateIndex < usableCandidates.length; candidateIndex++) {
        const candidate = usableCandidates[candidateIndex];
        const applied = applyMessage(normalized.node.state, decision.playerId, candidate.message);
        searchedNodes++;
        if (!applied) continue;

        const moves = decision.playerId === playerId
          ? [
              ...normalized.node.moves,
              buildMove(normalized.node.state, decision.playerId, decision.decisionType, candidate),
            ]
          : normalized.node.moves;

        const child = scoreNode({ state: applied, moves, score: 0 }, playerId);
        nextBeam.push(child);

        if (
          actorIsTarget
          && shouldMacroExpand(decision.decisionType)
          && candidateIndex < 4
          && Date.now() - start < opts.timeBudgetMs
        ) {
          for (const profile of portfolioProfiles.slice(0, 3)) {
            const macro = completeMacroTurn(child, playerId, opts, start + opts.timeBudgetMs, profile);
            searchedNodes += macro.searched;
            nextBeam.push(macro.node);
          }
        }
      }
    }

    if (nextBeam.length === 0) break;

    nextBeam.sort((a, b) => b.score - a.score);
    beam = rankAndPruneNodes(nextBeam, opts.beamWidth, playerId);
    if (beam[0] && beam[0].score >= best.score) best = beam[0];
    emitProgress();
    if (allComplete) {
      break;
    }
  }

  const completionDeadline = start + opts.timeBudgetMs + COMPLETION_GRACE_MS;
  const completionSeeds = rankAndPruneNodes(
    [...completedNodes, ...beam, best]
      .sort((a, b) => b.score - a.score),
    opts.completionWidth,
    playerId,
  );

  for (let seedIndex = 0; seedIndex < completionSeeds.length; seedIndex++) {
    const seed = completionSeeds[seedIndex];
    const normalized = normalizeNode(seed, playerId);
    searchedNodes += normalized.searched;
    if (normalized.node.state.currentPhase === 'GAME_OVER') {
      recordCompleted(normalized.node);
      continue;
    }

    const profilesForSeed: Array<StrategyProfile | undefined> = seedIndex < 8
      ? [undefined, ...portfolioProfiles.slice(0, normalized.node.state.roundNumber >= 6 ? 4 : 2)]
      : [undefined];

    for (const profile of profilesForSeed) {
      const forceFirstFullLine = completedNodes.length === 0;
      if (!forceFirstFullLine && Date.now() > completionDeadline) break;

      const rollout = completeLineToGameOver(
        normalized.node,
        playerId,
        opts,
        completionDeadline,
        forceFirstFullLine,
        profile,
      );
      searchedNodes += rollout.searched;
      if (rollout.completed) {
        recordCompleted(rollout.node);
      } else if (rollout.node.score > best.score) {
        best = rollout.node;
      }
      emitProgress();
    }
  }

  const finalBest = completedNodes.length > 0
    ? completedNodes.sort((a, b) => solvedNodeScore(b, playerId) - solvedNodeScore(a, playerId))[0]
    : normalizeNode(best, playerId).node;
  const horizon: LiveSolverResult['horizon'] = finalBest.state.currentPhase === 'GAME_OVER' ? 'FULL_GAME' : 'PARTIAL';
  emitProgress(true, horizon === 'FULL_GAME'
    ? 'Best full-game line found so far. Search is still running.'
    : 'Best partial line found so far. Search is still running.');

  const exact = opts.skipExactSearch
    ? {
        score: heuristicScore(state, playerId),
        node: scoreNode({ state: cloneGameState(state), moves: [], score: 0 }, playerId),
        proven: false,
        reason: 'Progressive line search is still running; exact proof is deferred.',
        nodes: 0,
        cacheHits: 0,
      }
    : runExactProofSearch(state, playerId, opts, Date.now());
  if (exact.proven) {
    return provenExactResult(requestId, playerId, start, exact);
  }

  const projection = projectScores(finalBest.state, playerId);
  const currentMove = finalBest.moves[0] ?? null;

  return {
    requestId,
    playerId,
    generatedAt: Date.now(),
    status: 'READY',
    message: horizon === 'FULL_GAME'
      ? 'Full-game rollout simulated to final scoring.'
      : 'Partial line returned because no complete rollout finished before the search cap.',
    currentMove,
    rounds: groupMovesByRound(finalBest.moves),
    projections: projection.scores,
    projectedMargin: projection.margin,
    searchedNodes,
    completedLines: completedNodes.length,
    computeMs: Date.now() - start,
    horizon,
    proofStatus: 'UNPROVEN',
    proofNodes: exact.nodes,
    proofReason: exact.reason,
    opponentModel: 'LIGHTWEIGHT_ACHIEVEMENT_EVENT_FIELD',
  };
}

function buildUnprovenResult({
  requestId,
  playerId,
  start,
  node,
  searchedNodes,
  completedLines,
  proofNodes,
  proofReason,
  message,
}: {
  requestId: string;
  playerId: string;
  start: number;
  node: SearchNode;
  searchedNodes: number;
  completedLines: number;
  proofNodes: number;
  proofReason: string;
  message: string;
}): LiveSolverResult {
  const horizon: LiveSolverResult['horizon'] = node.state.currentPhase === 'GAME_OVER' ? 'FULL_GAME' : 'PARTIAL';
  const projection = projectScores(node.state, playerId);
  return {
    requestId,
    playerId,
    generatedAt: Date.now(),
    status: 'READY',
    message,
    currentMove: node.moves[0] ?? null,
    rounds: groupMovesByRound(node.moves),
    projections: projection.scores,
    projectedMargin: projection.margin,
    searchedNodes,
    completedLines,
    computeMs: Date.now() - start,
    horizon,
    proofStatus: 'UNPROVEN',
    proofNodes,
    proofReason,
    opponentModel: 'LIGHTWEIGHT_ACHIEVEMENT_EVENT_FIELD',
  };
}

function sanitizeOptions(options: Partial<SearchOptions>): SearchOptions {
  return {
    timeBudgetMs: clampNumber(options.timeBudgetMs, 500, 600000, DEFAULT_OPTIONS.timeBudgetMs),
    beamWidth: clampNumber(options.beamWidth, 8, 1024, DEFAULT_OPTIONS.beamWidth),
    targetBranches: clampNumber(options.targetBranches, 4, 160, DEFAULT_OPTIONS.targetBranches),
    opponentBranches: clampNumber(options.opponentBranches, 1, 6, DEFAULT_OPTIONS.opponentBranches),
    completionWidth: clampNumber(options.completionWidth, 1, 320, DEFAULT_OPTIONS.completionWidth),
    maxDecisionPlies: clampNumber(options.maxDecisionPlies, 120, 6000, DEFAULT_OPTIONS.maxDecisionPlies),
    exactTimeBudgetMs: clampNumber(options.exactTimeBudgetMs, 0, 60000, DEFAULT_OPTIONS.exactTimeBudgetMs),
    exactNodeLimit: clampNumber(options.exactNodeLimit, 0, 5_000_000, DEFAULT_OPTIONS.exactNodeLimit),
    progressIntervalMs: clampNumber(options.progressIntervalMs, 250, 10000, DEFAULT_OPTIONS.progressIntervalMs),
    skipExactSearch: options.skipExactSearch === true,
    referenceLines: sanitizeReferenceLines(options.referenceLines),
    referenceLineWeight: clampNumber(options.referenceLineWeight, 0, 80, DEFAULT_OPTIONS.referenceLineWeight),
  };
}

function sanitizeReferenceLines(lines: LiveSolverReferenceLine[] | undefined): LiveSolverReferenceLine[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter(line => Number.isFinite(line.score) && Array.isArray(line.moves))
    .sort((a, b) => b.score - a.score)
    .slice(0, 240)
    .map(line => ({
      score: line.score,
      projectedMargin: typeof line.projectedMargin === 'number' ? line.projectedMargin : null,
      scenarioKey: typeof line.scenarioKey === 'string' ? line.scenarioKey : undefined,
      tags: Array.isArray(line.tags) ? line.tags.slice(0, 32) : undefined,
      moves: line.moves
        .filter(move => typeof move.round === 'number' && typeof move.phase === 'string' && typeof move.decisionType === 'string')
        .slice(0, 140)
        .map(move => ({
          round: move.round,
          phase: move.phase,
          decisionType: move.decisionType,
          message: move.message ?? null,
        })),
    }));
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeNode(node: SearchNode, playerId: string): { node: SearchNode; searched: number } {
  let current = node;
  let searched = 0;
  for (let i = 0; i < 80; i++) {
    if (current.state.currentPhase === 'GAME_OVER') break;

    const display = current.state.pendingDecisions.find(d => d.decisionType === 'PHASE_DISPLAY');
    if (display) {
      const displayMove = buildAutoDisplayMove(current.state, playerId, display);
      const state = autoResolve(current.state, display.playerId);
      searched++;
      current = scoreNode({
        ...current,
        state,
        moves: displayMove && !hasEquivalentMove(current.moves, displayMove)
          ? [...current.moves, displayMove]
          : current.moves,
      }, playerId);
      continue;
    }

    const activation = chooseBestActivation(current.state);
    if (!activation) break;
    const state = applyMessage(current.state, activation.playerId, activation.candidate.message);
    if (!state) break;
    searched++;
    const moves = activation.playerId === playerId
      ? [
          ...current.moves,
          buildMove(current.state, activation.playerId, 'ACTIVATE_DEV', activation.candidate),
        ]
      : current.moves;
    current = scoreNode({ state, moves, score: 0 }, playerId);
  }
  return { node: current, searched };
}

function pickDecision(state: GameState, targetPlayerId: string): GameState['pendingDecisions'][number] | null {
  const real = state.pendingDecisions.filter(d => d.decisionType !== 'PHASE_DISPLAY');
  if (real.length === 0) return null;
  return real.find(d => d.playerId === targetPlayerId) ?? real[0];
}

function runExactProofSearch(
  state: GameState,
  targetPlayerId: string,
  opts: SearchOptions,
  startMs: number,
): ExactSearchResult {
  if (opts.exactTimeBudgetMs <= 0 || opts.exactNodeLimit <= 0) {
    return {
      score: heuristicScore(state, targetPlayerId),
      node: scoreNode({ state: cloneGameState(state), moves: [], score: 0 }, targetPlayerId),
      proven: false,
      reason: 'Exact proof search disabled.',
      nodes: 0,
      cacheHits: 0,
    };
  }

  const root = scoreNode({ state: cloneGameState(state), moves: [], score: 0 }, targetPlayerId);
  const ctx: ExactSearchContext = {
    targetPlayerId,
    startMs,
    deadlineMs: startMs + opts.exactTimeBudgetMs,
    nodeLimit: opts.exactNodeLimit,
    nodes: 0,
    cacheHits: 0,
    cache: new Map(),
  };
  const result = exactMinimax(root, ctx, -Infinity, Infinity);
  return {
    ...result,
    nodes: ctx.nodes,
    cacheHits: ctx.cacheHits,
  };
}

function exactMinimax(
  node: SearchNode,
  ctx: ExactSearchContext,
  alpha: number,
  beta: number,
): Omit<ExactSearchResult, 'nodes' | 'cacheHits'> {
  if (Date.now() > ctx.deadlineMs) {
    return {
      score: heuristicScore(node.state, ctx.targetPlayerId),
      node: scoreNode(node, ctx.targetPlayerId),
      proven: false,
      reason: 'Exact proof search reached its time budget.',
    };
  }
  if (ctx.nodes >= ctx.nodeLimit) {
    return {
      score: heuristicScore(node.state, ctx.targetPlayerId),
      node: scoreNode(node, ctx.targetPlayerId),
      proven: false,
      reason: 'Exact proof search reached its node limit.',
    };
  }

  ctx.nodes++;
  const normalized = normalizeDisplaysOnly(node, ctx.targetPlayerId);
  ctx.nodes += normalized.searched;
  const current = normalized.node;

  if (current.state.currentPhase === 'GAME_OVER') {
    return {
      score: solvedStateScore(current.state, ctx.targetPlayerId),
      node: scoreNode(current, ctx.targetPlayerId),
      proven: true,
      reason: EXACT_PROOF_REASON,
    };
  }

  const cacheKey = exactCacheKey(current.state, ctx.targetPlayerId);
  const cached = ctx.cache.get(cacheKey);
  if (cached?.proven) {
    ctx.cacheHits++;
    return {
      score: cached.score,
      node: mergeCachedNode(current, cached.node),
      proven: true,
      reason: EXACT_PROOF_REASON,
    };
  }

  const decision = pickDecision(current.state, ctx.targetPlayerId);
  if (!decision) {
    if (current.state.currentPhase === 'ACHIEVEMENT' && current.state.roundNumber >= 9) {
      return exactTerminalActivationSearch(current, ctx, alpha, beta);
    }

    const before = exactStateSignature(current.state);
    const advanced = advancePhase(current.state);
    if (exactStateSignature(advanced) === before) {
      return {
        score: heuristicScore(current.state, ctx.targetPlayerId),
        node: scoreNode(current, ctx.targetPlayerId),
        proven: false,
        reason: 'Exact proof search reached a state that could not advance.',
      };
    }
    const result = exactMinimax({ ...current, state: advanced }, ctx, alpha, beta);
    if (result.proven) {
      ctx.cache.set(cacheKey, { score: result.score, node: stripPrefixMoves(current, result.node), proven: true });
    }
    return result;
  }

  const actorIsTarget = decision.playerId === ctx.targetPlayerId;
  const candidates = actorIsTarget
    ? enumerateExactCandidates(current.state, decision.playerId, decision.decisionType)
    : enumerateLightweightOpponentCandidates(current.state, decision.playerId, decision.decisionType);
  if (candidates.length === 0) {
    const before = exactStateSignature(current.state);
    const auto = autoResolve(current.state, decision.playerId);
    if (exactStateSignature(auto) === before) {
      return {
        score: heuristicScore(current.state, ctx.targetPlayerId),
        node: scoreNode(current, ctx.targetPlayerId),
        proven: false,
        reason: `No legal exact candidates found for ${decision.decisionType}.`,
      };
    }
    return exactMinimax({ ...current, state: auto }, ctx, alpha, beta);
  }

  const ordered = actorIsTarget
    ? orderExactCandidates(current.state, decision.playerId, candidates, ctx.targetPlayerId, true)
    : orderOpponentCandidates(current.state, decision.playerId, candidates, ctx.targetPlayerId);

  if (!actorIsTarget) {
    const candidate = ordered[0];
    const applied = candidate ? applyMessage(current.state, decision.playerId, candidate.message) : null;
    if (!applied) {
      return {
        score: heuristicScore(current.state, ctx.targetPlayerId),
        node: scoreNode(current, ctx.targetPlayerId),
        proven: false,
        reason: `No lightweight opponent candidate could be applied for ${decision.decisionType}.`,
      };
    }

    const child = scoreNode({ state: applied, moves: current.moves, score: 0 }, ctx.targetPlayerId);
    const result = exactMinimax(child, ctx, alpha, beta);
    return {
      ...result,
      proven: false,
      reason: result.reason === EXACT_PROOF_REASON ? LIGHTWEIGHT_OPPONENT_REASON : result.reason,
    };
  }

  let bestScore = actorIsTarget ? -Infinity : Infinity;
  let bestNode: SearchNode | null = null;
  let allChildrenProven = true;
  let reason = 'Every legal continuation was searched to final scoring.';

  for (const candidate of ordered) {
    const applied = applyMessage(current.state, decision.playerId, candidate.message);
    if (!applied) continue;

    const moves = decision.playerId === ctx.targetPlayerId
      ? [
          ...current.moves,
          buildMove(current.state, decision.playerId, decision.decisionType, candidate),
        ]
      : current.moves;
    const child = scoreNode({ state: applied, moves, score: 0 }, ctx.targetPlayerId);
    const result = exactMinimax(child, ctx, alpha, beta);
    if (!result.proven) {
      allChildrenProven = false;
      reason = result.reason;
    }

    if (actorIsTarget) {
      if (result.score > bestScore) {
        bestScore = result.score;
        bestNode = result.node;
      }
      alpha = Math.max(alpha, bestScore);
      if (allChildrenProven && alpha >= beta) break;
    } else {
      if (result.score < bestScore) {
        bestScore = result.score;
        bestNode = result.node;
      }
      beta = Math.min(beta, bestScore);
      if (allChildrenProven && beta <= alpha) break;
    }
  }

  if (!bestNode) {
    return {
      score: heuristicScore(current.state, ctx.targetPlayerId),
      node: scoreNode(current, ctx.targetPlayerId),
      proven: false,
      reason: `All exact candidates failed to apply for ${decision.decisionType}.`,
    };
  }

  const proven = allChildrenProven;
  const result = {
    score: bestScore,
    node: scoreNode(bestNode, ctx.targetPlayerId),
    proven,
    reason: proven ? EXACT_PROOF_REASON : reason,
  };
  if (proven) {
    ctx.cache.set(cacheKey, { score: result.score, node: stripPrefixMoves(current, result.node), proven: true });
  }
  return result;
}

function exactTerminalActivationSearch(
  node: SearchNode,
  ctx: ExactSearchContext,
  alpha: number,
  beta: number,
): Omit<ExactSearchResult, 'nodes' | 'cacheHits'> {
  const activationPlayerIds = orderedActivationPlayers(node.state, ctx.targetPlayerId);
  if (activationPlayerIds.length === 0) {
    const before = exactStateSignature(node.state);
    const advanced = advancePhase(node.state);
    if (exactStateSignature(advanced) === before) {
      return {
        score: heuristicScore(node.state, ctx.targetPlayerId),
        node: scoreNode(node, ctx.targetPlayerId),
        proven: false,
        reason: 'Exact proof search could not enter final scoring.',
      };
    }
    return exactMinimax({ ...node, state: advanced }, ctx, alpha, beta);
  }

  const chooseActivations = (
    current: SearchNode,
    index: number,
    innerAlpha: number,
    innerBeta: number,
  ): Omit<ExactSearchResult, 'nodes' | 'cacheHits'> => {
    if (Date.now() > ctx.deadlineMs) {
      return {
        score: heuristicScore(current.state, ctx.targetPlayerId),
        node: scoreNode(current, ctx.targetPlayerId),
        proven: false,
        reason: 'Exact proof search reached its time budget.',
      };
    }
    if (ctx.nodes >= ctx.nodeLimit) {
      return {
        score: heuristicScore(current.state, ctx.targetPlayerId),
        node: scoreNode(current, ctx.targetPlayerId),
        proven: false,
        reason: 'Exact proof search reached its node limit.',
      };
    }

    if (index >= activationPlayerIds.length) {
      const before = exactStateSignature(current.state);
      const advanced = advancePhase(current.state);
      if (exactStateSignature(advanced) === before) {
        return {
          score: heuristicScore(current.state, ctx.targetPlayerId),
          node: scoreNode(current, ctx.targetPlayerId),
          proven: false,
          reason: 'Exact proof search could not enter final scoring.',
        };
      }
      return exactMinimax({ ...current, state: advanced }, ctx, innerAlpha, innerBeta);
    }

    const actorId = activationPlayerIds[index];
    const actorIsTarget = actorId === ctx.targetPlayerId;
    const options = enumerateTerminalActivationOptions(current.state, actorId);
    let bestScore = actorIsTarget ? -Infinity : Infinity;
    let bestNode: SearchNode | null = null;
    let allChildrenProven = true;
    let reason = EXACT_PROOF_REASON;

    for (const option of options) {
      ctx.nodes++;
      const moves = actorIsTarget && option.candidates.length > 0
        ? [
            ...current.moves,
            ...option.candidates.map(candidate => buildMove(current.state, actorId, 'ACTIVATE_DEV', candidate)),
          ]
        : current.moves;
      const result = chooseActivations(
        scoreNode({ state: option.state, moves, score: 0 }, ctx.targetPlayerId),
        index + 1,
        innerAlpha,
        innerBeta,
      );
      if (!result.proven) {
        allChildrenProven = false;
        reason = result.reason;
      }

      if (actorIsTarget) {
        if (result.score > bestScore) {
          bestScore = result.score;
          bestNode = result.node;
        }
        innerAlpha = Math.max(innerAlpha, bestScore);
        if (allChildrenProven && innerAlpha >= innerBeta) break;
      } else {
        if (result.score < bestScore) {
          bestScore = result.score;
          bestNode = result.node;
        }
        innerBeta = Math.min(innerBeta, bestScore);
        if (allChildrenProven && innerBeta <= innerAlpha) break;
      }
    }

    if (!bestNode) {
      return {
        score: heuristicScore(current.state, ctx.targetPlayerId),
        node: scoreNode(current, ctx.targetPlayerId),
        proven: false,
        reason: 'No exact terminal activation branch could be applied.',
      };
    }

    return {
      score: bestScore,
      node: scoreNode(bestNode, ctx.targetPlayerId),
      proven: allChildrenProven,
      reason: allChildrenProven ? EXACT_PROOF_REASON : reason,
    };
  };

  return chooseActivations(node, 0, alpha, beta);
}

function orderedActivationPlayers(state: GameState, targetPlayerId: string): string[] {
  const available = new Set(state.players
    .filter(player => player.isConnected && !player.hasFlagged && getActivatableDevs(player).length > 0)
    .map(player => player.playerId));
  return [
    targetPlayerId,
    ...state.turnOrder.filter(playerId => playerId !== targetPlayerId),
    ...state.players.map(player => player.playerId).filter(playerId => playerId !== targetPlayerId),
  ].filter((playerId, index, all) => available.has(playerId) && all.indexOf(playerId) === index);
}

function enumerateTerminalActivationOptions(
  state: GameState,
  actorId: string,
): Array<{ state: GameState; candidates: Candidate[] }> {
  const actor = state.players.find(player => player.playerId === actorId);
  if (!actor) return [{ state, candidates: [] }];

  const options: Array<{ state: GameState; candidates: Candidate[] }> = [{ state, candidates: [] }];
  let current = state;
  const appliedCandidates: Candidate[] = [];

  for (let i = 0; i < actor.gloryTrack; i++) {
    const devId = getActivatableDevs(current.players.find(player => player.playerId === actorId) ?? actor)[0];
    if (!devId) break;
    const candidate = activationCandidate(devId);
    const applied = applyMessage(current, actorId, candidate.message);
    if (!applied) break;
    current = applied;
    appliedCandidates.push(candidate);
    options.push({ state: current, candidates: [...appliedCandidates] });
  }

  return options;
}

function normalizeDisplaysOnly(node: SearchNode, targetPlayerId: string): { node: SearchNode; searched: number } {
  let current = node;
  let searched = 0;
  for (let i = 0; i < 80; i++) {
    if (current.state.currentPhase === 'GAME_OVER') break;
    const display = current.state.pendingDecisions.find(d => d.decisionType === 'PHASE_DISPLAY');
    if (!display) break;
    const displayMove = buildAutoDisplayMove(current.state, targetPlayerId, display);
    const state = autoResolve(current.state, display.playerId);
    searched++;
    current = scoreNode({
      ...current,
      state,
      moves: displayMove && !hasEquivalentMove(current.moves, displayMove)
        ? [...current.moves, displayMove]
        : current.moves,
    }, targetPlayerId);
  }
  return { node: current, searched };
}

function enumerateExactCandidates(
  state: GameState,
  actorId: string,
  decisionType: DecisionType,
): Candidate[] {
  const actor = state.players.find(p => p.playerId === actorId);
  if (!actor) return [];

  const activationCandidates = getActivatableDevs(actor).map(activationCandidate);
  const decisionCandidates = (() => {
    switch (decisionType) {
      case 'ROLL_DICE':
        return [{
          message: { type: 'ROLL_DICE' as const },
          instruction: 'Roll dice',
          detail: 'Reveal the scheduled dice for this round.',
          estimatedSeconds: 1,
          quickScore: 0,
        }];
      case 'ASSIGN_DICE':
        return enumerateDiceAssignments(state, actor, true);
      case 'RESOLVE_ACTION':
        return enumerateExactActionResolution(state, actor);
      case 'PROGRESS_TRACK':
        return enumerateProgress(state, actor, true);
      case 'ACHIEVEMENT_TRACK_CHOICE':
        return enumerateAchievementChoices(actor);
      case 'SELECT_CITY':
        return enumerateCityChoices(state, actorId);
      case 'DRAFT_CARD':
        return enumerateDraftChoices(state, actorId, 'DRAFT_CARD');
      case 'PICK_BAN_CARD':
        return enumerateDraftChoices(state, actorId, 'PICK_BAN_CARD');
      case 'ORACLE_CHOOSE_TOKEN':
        return enumerateOracleChoices(actor);
      case 'MILITARY_VICTORY_PROGRESS':
        return enumerateEventProgress(actor, ['ECONOMY', 'CULTURE', 'MILITARY'], 'Military Victory');
      case 'RISE_OF_PERSIA_PROGRESS':
        return enumerateEventProgress(actor, ['MILITARY'], 'Rise of Persia');
      case 'THIRTY_TYRANTS_DISCARD':
        return enumerateDiscardChoices(actor, true);
      case 'PROSPERITY_POLITICS':
        return [
          exactSkipCandidate('Prosperity: skip politics', 'Decline the optional Prosperity politics action.'),
          ...enumeratePoliticsCards(state, actor, 'Prosperity politics'),
        ];
      case 'CONQUEST_ACTION':
        return enumerateConquestActions(state, actor, true);
      default:
        return enumerateCandidates(state, actorId, decisionType, actorId);
    }
  })();

  return [...activationCandidates, ...decisionCandidates];
}

function enumerateExactActionResolution(state: GameState, actor: PlayerState): Candidate[] {
  const action = nextAction(actor);
  if (!action) return [];
  const candidates = enumerateActionResolution(state, actor, true);
  if (['LEGISLATION', 'POLITICS', 'DEVELOPMENT'].includes(action)) {
    candidates.push({
      message: { type: 'SKIP_PHASE' },
      instruction: `Skip ${ACTION_LABELS[action]} action`,
      detail: 'Exact search includes the legal option to skip this optional action.',
      estimatedSeconds: 1,
      quickScore: -25,
    });
  }
  return candidates;
}

function exactSkipCandidate(instruction: string, detail: string): Candidate {
  return {
    message: { type: 'SKIP_PHASE' },
    instruction,
    detail,
    estimatedSeconds: 1,
    quickScore: -25,
  };
}

function buildReferenceSearchBook(
  lines: LiveSolverReferenceLine[],
  weight: number,
): ReferenceSearchBook | null {
  if (lines.length === 0 || weight <= 0) return null;

  const priors = new Map<string, ReferenceMovePrior>();
  for (const line of lines) {
    const lineScore = referenceLineStrength(line);
    const tags = new Set(line.tags ?? []);

    for (const move of line.moves) {
      if (!move.message) continue;
      addReferencePrior(priors, referenceMoveKey(move.round, move.phase, move.decisionType, move.message), lineScore, tags);
      addReferencePrior(priors, referenceMoveKey('*', move.phase, move.decisionType, move.message), lineScore * 0.35, tags);
    }
  }

  return priors.size > 0 ? { weight, priors } : null;
}

function addReferencePrior(
  priors: Map<string, ReferenceMovePrior>,
  key: string,
  score: number,
  tags: Set<string>,
): void {
  const existing = priors.get(key);
  if (!existing) {
    priors.set(key, { score, lineCount: 1, tags: new Set(tags) });
    return;
  }

  existing.score = Math.max(existing.score, score) + Math.min(3, score * 0.08);
  existing.lineCount += 1;
  for (const tag of tags) existing.tags.add(tag);
}

function referenceLineStrength(line: LiveSolverReferenceLine): number {
  const margin = Math.max(0, line.projectedMargin ?? 0);
  const scoreAboveBaseline = Math.max(0, line.score - 45);
  return Math.min(36, 4 + scoreAboveBaseline * 0.42 + margin * 0.08);
}

function referenceCandidateBonus(
  state: GameState,
  actorId: string,
  decisionType: DecisionType,
  candidate: Candidate,
  targetPlayerId: string,
): number {
  if (!activeReferenceBook || actorId !== targetPlayerId) return 0;

  const exact = activeReferenceBook.priors.get(referenceMoveKey(
    state.roundNumber,
    state.currentPhase,
    decisionType,
    candidate.message,
  ));
  const flexible = activeReferenceBook.priors.get(referenceMoveKey(
    '*',
    state.currentPhase,
    decisionType,
    candidate.message,
  ));

  const raw = Math.max(exact?.score ?? 0, (flexible?.score ?? 0) * 0.55);
  if (raw <= 0) return 0;
  return raw * (activeReferenceBook.weight / DEFAULT_OPTIONS.referenceLineWeight);
}

function referenceMoveKey(
  round: number | '*',
  phase: GamePhase,
  decisionType: DecisionType | 'ACTIVATE_DEV',
  message: ClientMessage,
): string {
  return `${round}|${phase}|${decisionType}|${stableJson(message)}`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function orderExactCandidates(
  state: GameState,
  actorId: string,
  candidates: Candidate[],
  targetPlayerId: string,
  actorIsTarget: boolean,
): Candidate[] {
  return [...candidates].sort((a, b) => {
    const aState = applyMessage(state, actorId, a.message);
    const bState = applyMessage(state, actorId, b.message);
    const aScore = aState ? heuristicScore(aState, targetPlayerId) + a.quickScore * 0.02 : (actorIsTarget ? -Infinity : Infinity);
    const bScore = bState ? heuristicScore(bState, targetPlayerId) + b.quickScore * 0.02 : (actorIsTarget ? -Infinity : Infinity);
    return actorIsTarget ? bScore - aScore : aScore - bScore;
  });
}

function orderTargetCandidates(
  state: GameState,
  actorId: string,
  decisionType: DecisionType,
  candidates: Candidate[],
  targetPlayerId: string,
  profile?: StrategyProfile,
): Candidate[] {
  return candidates
    .map(candidate => {
      const applied = applyMessage(state, actorId, candidate.message);
      return {
        candidate,
        score: applied
          ? heuristicScore(applied, targetPlayerId)
            + candidate.quickScore * 0.02
            + candidateOutcomeScore(state, actorId, candidate, targetPlayerId) * 0.28
            + strategyCandidateBonus(state, actorId, candidate, profile) * 2.5
            + referenceCandidateBonus(state, actorId, decisionType, candidate, targetPlayerId)
            + endgameSuffixBonus(applied, targetPlayerId)
          : -Infinity,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.candidate);
}

function enumerateLightweightOpponentCandidates(
  state: GameState,
  actorId: string,
  decisionType: DecisionType,
): Candidate[] {
  const candidates = enumerateCandidates(state, actorId, decisionType, actorId);
  return candidates.length > 0 ? candidates : fallbackCandidates(state, actorId, decisionType);
}

function orderOpponentCandidates(
  state: GameState,
  actorId: string,
  candidates: Candidate[],
  targetPlayerId: string,
): Candidate[] {
  return candidates
    .map(candidate => ({
      candidate,
      score: opponentCandidateScore(state, actorId, candidate, targetPlayerId),
    }))
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.candidate);
}

function exactCacheKey(state: GameState, targetPlayerId: string): string {
  return `${targetPlayerId}|${exactStateSignature(state)}`;
}

function stripPrefixMoves(prefix: SearchNode, node: SearchNode): SearchNode {
  return {
    ...node,
    moves: node.moves.slice(prefix.moves.length),
  };
}

function mergeCachedNode(prefix: SearchNode, cached: SearchNode): SearchNode {
  return {
    ...cached,
    moves: [...prefix.moves, ...cached.moves],
  };
}

function chooseBestActivation(state: GameState): { playerId: string; candidate: Candidate; scoreDelta: number } | null {
  let best: { playerId: string; candidate: Candidate; scoreDelta: number } | null = null;

  for (const player of state.players) {
    if (!player.isConnected || player.hasFlagged) continue;
    for (const devId of getActivatableDevs(player)) {
      const candidate = activationCandidate(devId);
      const applied = applyMessage(state, player.playerId, candidate.message);
      if (!applied) continue;
      const scoreDelta = heuristicScore(applied, player.playerId) - heuristicScore(state, player.playerId);
      if (scoreDelta <= 0.05) continue;
      if (!best || scoreDelta > best.scoreDelta) {
        best = { playerId: player.playerId, candidate, scoreDelta };
      }
    }
  }

  return best;
}

function activationCandidate(devId: string): Candidate {
  if (devId === 'thebes-dev-2') {
    return {
      message: { type: 'ACTIVATE_DEV', devId },
      instruction: 'Activate Thebes: spend 1 Glory',
      detail: 'Lose 1 Glory to gain 2 drachma and 4 VP.',
      estimatedSeconds: 3,
      quickScore: 4.5,
    };
  }

  return {
    message: { type: 'ACTIVATE_DEV', devId },
    instruction: `Activate ${devId}`,
    detail: 'Use an unlocked city development ability.',
    estimatedSeconds: 3,
    quickScore: 0,
  };
}

function shouldMacroExpand(decisionType: DecisionType): boolean {
  return decisionType === 'ASSIGN_DICE'
    || decisionType === 'RESOLVE_ACTION'
    || decisionType === 'PROGRESS_TRACK';
}

function completeMacroTurn(
  node: SearchNode,
  targetPlayerId: string,
  opts: SearchOptions,
  deadlineMs: number,
  profile: StrategyProfile,
): { node: SearchNode; searched: number } {
  const startRound = node.state.roundNumber;
  let current = node;
  let searched = 0;

  for (let step = 0; step < Math.min(120, opts.maxDecisionPlies); step++) {
    if (Date.now() > deadlineMs) break;

    const normalized = normalizeNode(current, targetPlayerId);
    searched += normalized.searched;
    current = normalized.node;

    if (current.state.currentPhase === 'GAME_OVER' || current.state.roundNumber > startRound) break;

    const decision = pickDecision(current.state, targetPlayerId);
    if (!decision) {
      const before = stateSignature(current.state);
      const advanced = advancePhase(current.state);
      searched++;
      current = scoreNode({ ...current, state: advanced }, targetPlayerId);
      if (stateSignature(current.state) === before) break;
      continue;
    }

    const actorIsTarget = decision.playerId === targetPlayerId;
    const candidates = orderSearchCandidates(
      current.state,
      decision.playerId,
      decision.decisionType,
      targetPlayerId,
      actorIsTarget,
      profile,
    );
    const choice = chooseRolloutCandidate(
      current.state,
      decision.playerId,
      decision.decisionType,
      candidates.length > 0 ? candidates : fallbackCandidates(current.state, decision.playerId, decision.decisionType),
      targetPlayerId,
      actorIsTarget,
      actorIsTarget ? Math.min(opts.targetBranches, 14) : opts.opponentBranches,
      profile,
    );

    if (!choice) break;
    searched += choice.searched;
    const moves = actorIsTarget
      ? [
          ...current.moves,
          buildMove(current.state, decision.playerId, decision.decisionType, choice.candidate),
        ]
      : current.moves;
    current = scoreNode({ state: choice.state, moves, score: 0 }, targetPlayerId);
  }

  return { node: current, searched };
}

function completeLineToGameOver(
  node: SearchNode,
  targetPlayerId: string,
  opts: SearchOptions,
  deadlineMs: number,
  forceCompletion: boolean,
  profile?: StrategyProfile,
): { node: SearchNode; completed: boolean; searched: number } {
  let current = node;
  let searched = 0;

  for (let step = 0; step < opts.maxDecisionPlies; step++) {
    if (!forceCompletion && Date.now() > deadlineMs) break;

    const normalized = normalizeNode(current, targetPlayerId);
    searched += normalized.searched;
    current = normalized.node;

    if (current.state.currentPhase === 'GAME_OVER') {
      return { node: current, completed: true, searched };
    }

    const decision = pickDecision(current.state, targetPlayerId);
    if (!decision) {
      const before = stateSignature(current.state);
      const advanced = advancePhase(current.state);
      searched++;
      current = scoreNode({ ...current, state: advanced }, targetPlayerId);
      if (stateSignature(current.state) === before) break;
      continue;
    }

    const actorIsTarget = decision.playerId === targetPlayerId;
    const rankedCandidates = orderSearchCandidates(
      current.state,
      decision.playerId,
      decision.decisionType,
      targetPlayerId,
      actorIsTarget,
      profile,
    );
    const usableCandidates = rankedCandidates.length > 0
      ? rankedCandidates
      : fallbackCandidates(current.state, decision.playerId, decision.decisionType);

    const choice = chooseRolloutCandidate(
      current.state,
      decision.playerId,
      decision.decisionType,
      usableCandidates,
      targetPlayerId,
      actorIsTarget,
      actorIsTarget
        ? Math.min(opts.targetBranches, current.state.roundNumber >= 6 ? 24 : 10)
        : opts.opponentBranches,
      profile,
    );

    if (!choice) {
      const before = stateSignature(current.state);
      const auto = autoResolve(current.state, decision.playerId);
      searched++;
      current = scoreNode({ ...current, state: auto }, targetPlayerId);
      if (stateSignature(current.state) === before) break;
      continue;
    }

    searched += choice.searched;
    const moves = decision.playerId === targetPlayerId
      ? [
          ...current.moves,
          buildMove(current.state, decision.playerId, decision.decisionType, choice.candidate),
        ]
      : current.moves;
    current = scoreNode({ state: choice.state, moves, score: 0 }, targetPlayerId);
  }

  return { node: current, completed: current.state.currentPhase === 'GAME_OVER', searched };
}

function chooseRolloutCandidate(
  state: GameState,
  actorId: string,
  decisionType: DecisionType,
  candidates: Candidate[],
  targetPlayerId: string,
  actorIsTarget: boolean,
  limit: number,
  profile?: StrategyProfile,
): { candidate: Candidate; state: GameState; searched: number } | null {
  let best: { candidate: Candidate; state: GameState; score: number; searched: number } | null = null;
  let searched = 0;

  for (const candidate of candidates.slice(0, Math.max(1, limit))) {
    const applied = applyMessage(state, actorId, candidate.message);
    searched++;
    if (!applied) continue;
    const score = actorIsTarget
      ? heuristicScore(applied, targetPlayerId)
        + candidate.quickScore * 0.08
        + strategyCandidateBonus(state, actorId, candidate, profile) * 3
        + referenceCandidateBonus(state, actorId, decisionType, candidate, targetPlayerId)
        + endgameSuffixBonus(applied, targetPlayerId)
      : opponentCandidateScore(state, actorId, candidate, targetPlayerId);
    if (!best || score > best.score) {
      best = { candidate, state: applied, score, searched };
    }
  }

  return best ? { candidate: best.candidate, state: best.state, searched } : null;
}

function enumerateCandidates(
  state: GameState,
  actorId: string,
  decisionType: DecisionType,
  scoringPlayerId: string,
): Candidate[] {
  const actor = state.players.find(p => p.playerId === actorId);
  if (!actor) return [];

  let candidates: Candidate[] = [];
  switch (decisionType) {
    case 'ROLL_DICE':
      candidates = [{
        message: { type: 'ROLL_DICE' },
        instruction: 'Roll dice',
        detail: 'Reveal the scheduled dice for this round.',
        estimatedSeconds: 1,
        quickScore: 0,
      }];
      break;
    case 'ASSIGN_DICE':
      candidates = enumerateDiceAssignments(state, actor);
      break;
    case 'RESOLVE_ACTION':
      candidates = enumerateActionResolution(state, actor);
      break;
    case 'PROGRESS_TRACK':
      candidates = enumerateProgress(state, actor);
      break;
    case 'ACHIEVEMENT_TRACK_CHOICE':
      candidates = enumerateAchievementChoices(actor);
      break;
    case 'SELECT_CITY':
      candidates = enumerateCityChoices(state, actorId);
      break;
    case 'DRAFT_CARD':
      candidates = enumerateDraftChoices(state, actorId, 'DRAFT_CARD');
      break;
    case 'PICK_BAN_CARD':
      candidates = enumerateDraftChoices(state, actorId, 'PICK_BAN_CARD');
      break;
    case 'ORACLE_CHOOSE_TOKEN':
      candidates = enumerateOracleChoices(actor);
      break;
    case 'MILITARY_VICTORY_PROGRESS':
      candidates = enumerateEventProgress(actor, ['ECONOMY', 'CULTURE', 'MILITARY'], 'Military Victory');
      break;
    case 'RISE_OF_PERSIA_PROGRESS':
      candidates = enumerateEventProgress(actor, ['MILITARY'], 'Rise of Persia');
      break;
    case 'THIRTY_TYRANTS_DISCARD':
      candidates = enumerateDiscardChoices(actor);
      break;
    case 'PROSPERITY_POLITICS':
      candidates = enumeratePoliticsCards(state, actor, 'Prosperity politics');
      break;
    case 'CONQUEST_ACTION':
      candidates = enumerateConquestActions(state, actor);
      break;
    default:
      candidates = [];
  }

  const scored = candidates
    .map(candidate => ({
      candidate,
      score: candidate.quickScore + candidateOutcomeScore(state, actorId, candidate, scoringPlayerId),
    }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.candidate);

  return scored;
}

function orderSearchCandidates(
  state: GameState,
  actorId: string,
  decisionType: DecisionType,
  targetPlayerId: string,
  actorIsTarget: boolean,
  profile?: StrategyProfile,
): Candidate[] {
  const candidates = enumerateCandidates(state, actorId, decisionType, actorIsTarget ? targetPlayerId : actorId);
  return actorIsTarget
    ? orderTargetCandidates(state, actorId, decisionType, candidates, targetPlayerId, profile)
    : orderOpponentCandidates(state, actorId, candidates, targetPlayerId);
}

function fallbackCandidates(state: GameState, actorId: string, decisionType: DecisionType): Candidate[] {
  if (decisionType === 'RESOLVE_ACTION') {
    const actor = state.players.find(p => p.playerId === actorId);
    const action = actor ? nextAction(actor) : null;
    if (action && ['LEGISLATION', 'POLITICS', 'DEVELOPMENT'].includes(action)) {
      return [{
        message: { type: 'SKIP_PHASE' },
        instruction: `Skip ${ACTION_LABELS[action]} action`,
        detail: 'No reliable candidate was found for this optional action.',
        estimatedSeconds: 1,
        quickScore: -50,
      }];
    }
  }
  return [{
    message: { type: 'SKIP_PHASE' },
    instruction: 'Skip',
    detail: `Fallback for ${decisionType}.`,
    estimatedSeconds: 1,
    quickScore: -100,
  }];
}

function enumerateDiceAssignments(state: GameState, actor: PlayerState, exact = false): Candidate[] {
  const dice = actor.diceRoll ?? state.predeterminedDice[state.roundNumber]?.[actor.playerId] ?? [];
  if (dice.length === 0) return [];

  const actionTypes = (Object.keys(ACTION_NUMBERS) as ActionType[])
    .filter(action => exact || actionLikelyUseful(state, actor, action));
  const combos = combinations(actionTypes, dice.length);
  const candidates: Candidate[] = [];

  for (const actions of combos) {
    const assignments = bestDicePairing(dice, actions);
    const citizenCost = assignments.reduce((sum, assignment) =>
      sum + Math.max(0, ACTION_NUMBERS[assignment.actionType] - assignment.dieValue), 0);
    const maxScrolls = Math.min(actor.philosophyTokens, Math.ceil(Math.max(0, citizenCost - actor.citizenTrack) / 3));
    for (let spend = 0; spend <= maxScrolls; spend++) {
      if (citizenCost > actor.citizenTrack + spend * 3) continue;
      const message: ClientMessage = {
        type: 'ASSIGN_DICE',
        assignments,
        philosophyTokensToSpend: spend > 0 ? spend : undefined,
      };
      const actionNames = assignments
        .slice()
        .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType])
        .map(a => `${a.dieValue} to ${ACTION_LABELS[a.actionType]}`);
      candidates.push({
        message,
        instruction: `Assign ${joinNatural(actionNames)}`,
        detail: spend > 0
          ? `Spend ${spend} scroll${spend === 1 ? '' : 's'} first to cover citizen cost ${citizenCost}.`
          : `Citizen cost ${citizenCost}.`,
        estimatedSeconds: 8,
        quickScore: actions.reduce((sum, action) => sum + actionPriority(state, actor, action), 0) - citizenCost * 1.5 - spend * 0.75,
      });
    }
  }

  return candidates;
}

function bestDicePairing(dice: number[], actions: ActionType[]): Array<{ slotIndex: 0 | 1 | 2; actionType: ActionType; dieValue: number }> {
  const sortedDice = [...dice].sort((a, b) => b - a);
  const sortedActions = [...actions].sort((a, b) => ACTION_NUMBERS[b] - ACTION_NUMBERS[a]);
  return sortedActions.map((actionType, index) => ({
    slotIndex: index as 0 | 1 | 2,
    actionType,
    dieValue: sortedDice[index],
  }));
}

function enumerateActionResolution(state: GameState, actor: PlayerState, exact = false): Candidate[] {
  const action = nextAction(actor);
  if (!action) return [];
  switch (action) {
    case 'PHILOSOPHY':
    case 'CULTURE':
      return [{
        message: { type: 'RESOLVE_ACTION', actionType: action, choices: {} },
        instruction: `Resolve ${ACTION_LABELS[action]}`,
        detail: action === 'PHILOSOPHY' ? 'Gain 1 scroll.' : `Gain ${actor.cultureTrack} VP.`,
        estimatedSeconds: 2,
        quickScore: actionPriority(state, actor, action),
      }];
    case 'TRADE':
      return enumerateTrade(actor);
    case 'MILITARY':
      return enumerateMilitary(state, actor, exact);
    case 'LEGISLATION':
      return enumerateLegislation(state, actor);
    case 'POLITICS':
      return enumeratePoliticsCards(state, actor, 'Politics');
    case 'DEVELOPMENT':
      return enumerateDevelopment(state, actor, exact);
  }
}

function enumerateTrade(actor: PlayerState): Candidate[] {
  const afterIncome = actor.coins + actor.economyTrack + 1;
  const tokenCost = hasCard(actor, 'corinthian-columns') ? 3 : 5;
  const candidates: Candidate[] = [{
    message: { type: 'RESOLVE_ACTION', actionType: 'TRADE', choices: {} },
    instruction: 'Trade for drachma',
    detail: `Gain ${actor.economyTrack + 1} drachma.`,
    estimatedSeconds: 3,
    quickScore: actor.economyTrack + 1,
  }];

  if (afterIncome >= tokenCost) {
    for (const color of rankedKnowledgeColors(actor)) {
      candidates.push({
        message: {
          type: 'RESOLVE_ACTION',
          actionType: 'TRADE',
          choices: { buyMinorKnowledge: true, minorKnowledgeColor: color },
        },
        instruction: `Trade and buy ${formatColor(color)} minor`,
        detail: `Gain ${actor.economyTrack + 1} drachma, then spend ${tokenCost} on a ${formatColor(color)} minor token.`,
        estimatedSeconds: 5,
        quickScore: actor.economyTrack + 6 + knowledgeColorNeed(actor, color),
      });
    }
  }

  return candidates;
}

function enumerateMilitary(state: GameState, actor: PlayerState, exact = false): Candidate[] {
  const troopAfterGain = actor.troopTrack + actor.militaryTrack;
  const candidates: Candidate[] = [{
    message: { type: 'RESOLVE_ACTION', actionType: 'MILITARY', choices: {} },
    instruction: 'Military without exploring',
    detail: `Gain ${actor.militaryTrack} troops.`,
    estimatedSeconds: 3,
    quickScore: actor.militaryTrack,
  }];

  const explorable = state.centralBoardTokens
    .filter(t => !t.explored && canExploreToken(actor, t, troopAfterGain))
    .sort((a, b) => tokenValue(b) - tokenValue(a))
    .slice(0, exact ? undefined : hasDevUnlocked(actor, 'thebes-dev-3') ? 5 : 4);

  for (const token of explorable) {
    candidates.push({
      message: {
        type: 'RESOLVE_ACTION',
        actionType: 'MILITARY',
        choices: { explorationTokenId: token.id },
      },
      instruction: `Military: explore ${tokenLabel(token)}`,
      detail: `Gain ${actor.militaryTrack} troops, then take ${tokenLabel(token)}.`,
      estimatedSeconds: 8,
      quickScore: actor.militaryTrack + tokenValue(token),
    });
  }

  if (hasDevUnlocked(actor, 'thebes-dev-3') && explorable.length >= 2) {
    const pairLimit = exact ? explorable.length : Math.min(3, explorable.length);
    for (let i = 0; i < pairLimit; i++) {
      for (let j = 0; j < pairLimit; j++) {
        if (i === j) continue;
        const first = explorable[i];
        const second = explorable[j];
        candidates.push({
          message: {
            type: 'RESOLVE_ACTION',
            actionType: 'MILITARY',
            choices: { explorationTokenId: first.id, secondExplorationTokenId: second.id },
          },
          instruction: `Military: explore ${tokenLabel(first)}, then ${tokenLabel(second)}`,
          detail: 'Uses Thebes development to explore twice.',
          estimatedSeconds: 12,
          quickScore: actor.militaryTrack + tokenValue(first) + tokenValue(second),
        });
      }
    }
  }

  return candidates;
}

function enumerateLegislation(state: GameState, actor: PlayerState): Candidate[] {
  return state.politicsDeck.slice(0, 2).map(card => ({
    message: { type: 'RESOLVE_ACTION', actionType: 'LEGISLATION', choices: { targetCardId: card.id } },
    instruction: `Legislation: keep ${card.name}`,
    detail: 'Gain 3 citizens and keep this card from the draw.',
    estimatedSeconds: 6,
    quickScore: cardValue(card, actor, state),
  }));
}

function enumeratePoliticsCards(state: GameState, actor: PlayerState, source: string): Candidate[] {
  return actor.handCards
    .flatMap(card => politicsCandidates(state, actor, card, source))
    .sort((a, b) => b.quickScore - a.quickScore);
}

function politicsCandidates(state: GameState, actor: PlayerState, card: PoliticsCard, source: string): Candidate[] {
  if (actor.coins < card.cost) return [];
  const pairs = knowledgeShortfall(actor, card.knowledgeRequirement);
  if (pairs * 2 > actor.philosophyTokens) return [];

  const choices: ActionChoices = {
    targetCardId: card.id,
    philosophyPairsToUse: pairs > 0 ? pairs : undefined,
  };
  if (card.id === 'scholarly-welcome') {
    return rankedKnowledgeColors(actor).map(color => politicsCandidateFromChoices(state, actor, card, source, {
      ...choices,
      scholarlyWelcomeColor: color,
    }));
  }
  if (card.id === 'ostracism' && actor.playedCards.length > 0) {
    const returnable = actor.playedCards
      .filter(played => played.id !== 'ostracism')
      .sort((a, b) => cardValue(b, actor, state) - cardValue(a, actor, state));
    if (returnable.length > 0) {
      return returnable.map(played => politicsCandidateFromChoices(state, actor, card, source, {
        ...choices,
        ostracismReturnCardId: played.id,
      }));
    }
  }

  return [politicsCandidateFromChoices(state, actor, card, source, choices)];
}

function politicsCandidateFromChoices(
  state: GameState,
  actor: PlayerState,
  card: PoliticsCard,
  source: string,
  choices: ActionChoices,
): Candidate {
  const pairs = choices.philosophyPairsToUse ?? 0;
  const choiceDetail =
    card.id === 'scholarly-welcome' && choices.scholarlyWelcomeColor
      ? `take ${formatColor(choices.scholarlyWelcomeColor)} minor`
      : card.id === 'ostracism' && choices.ostracismReturnCardId
        ? `return ${cardName(state, actor, choices.ostracismReturnCardId)}`
        : null;

  return {
    message: { type: 'RESOLVE_ACTION', actionType: 'POLITICS', choices },
    instruction: choiceDetail
      ? `${source}: play ${card.name} (${choiceDetail})`
      : `${source}: play ${card.name}`,
    detail: [
      card.cost > 0 ? `Pay ${card.cost} drachma` : 'Free card',
      pairs > 0 ? `spend ${pairs * 2} scrolls for missing knowledge` : 'requirements met',
      choiceDetail,
    ].filter((part): part is string => Boolean(part)).join('; '),
    estimatedSeconds: 10,
    quickScore: cardValue(card, actor, state) - card.cost - pairs * 2,
  };
}

function enumerateDevelopment(state: GameState, actor: PlayerState, exact = false): Candidate[] {
  const city = getAllCityCards().find(c => c.id === actor.cityId);
  const dev = city?.developments[actor.developmentLevel] ?? null;
  if (!dev || actor.coins < dev.drachmaCost) return [];
  const pairs = knowledgeShortfall(actor, dev.knowledgeRequirement);
  if (pairs * 2 > actor.philosophyTokens) return [];

  const baseChoices: ActionChoices = {
    philosophyPairsToUse: pairs > 0 ? pairs : undefined,
  };
  const choicesList: ActionChoices[] = [baseChoices];

  if (dev.id === 'miletus-dev-2') {
    choicesList.splice(0, choicesList.length,
      { ...baseChoices, devTrackChoices: ['ECONOMY', 'CULTURE'] },
      { ...baseChoices, devTrackChoices: ['ECONOMY', 'MILITARY'] },
      { ...baseChoices, devTrackChoices: ['CULTURE', 'MILITARY'] },
    );
  }
  if (dev.id === 'argos-dev-2') {
    choicesList.splice(0, choicesList.length,
      { ...baseChoices, argosDevReward: 'vp' },
      { ...baseChoices, argosDevReward: 'coins' },
      { ...baseChoices, argosDevReward: 'citizens' },
      { ...baseChoices, argosDevReward: 'troops' },
    );
  }
  if (dev.id === 'sparta-dev-3') {
    const allTokens = state.centralBoardTokens
      .filter(t => !t.explored)
      .sort((a, b) => tokenValue(b) - tokenValue(a));
    const firstExploreTokens = allTokens
      .filter(t => canExploreToken(actor, t, actor.troopTrack + actor.militaryTrack))
      .slice(0, exact ? undefined : 6);
    const secondExploreTokens = (exact ? allTokens : firstExploreTokens).slice(0, exact ? undefined : 6);
    choicesList.splice(0, choicesList.length, baseChoices);
    for (const token of firstExploreTokens) {
      choicesList.push({ ...baseChoices, spartaMilitaryTokenIds: [token.id] });
    }
    const firstLimit = exact ? firstExploreTokens.length : Math.min(4, firstExploreTokens.length);
    const secondLimit = exact ? secondExploreTokens.length : Math.min(4, secondExploreTokens.length);
    for (let i = 0; i < firstLimit; i++) {
      for (let j = 0; j < secondLimit; j++) {
        if (firstExploreTokens[i].id === secondExploreTokens[j].id) continue;
        choicesList.push({ ...baseChoices, spartaMilitaryTokenIds: [firstExploreTokens[i].id, secondExploreTokens[j].id] });
      }
    }
  }

  return choicesList.map(choices => ({
    message: { type: 'RESOLVE_ACTION', actionType: 'DEVELOPMENT', choices },
    instruction: `Develop: ${dev.name}`,
    detail: [
      dev.drachmaCost > 0 ? `Pay ${dev.drachmaCost} drachma` : 'No drachma cost',
      pairs > 0 ? `spend ${pairs * 2} scrolls for missing knowledge` : 'requirements met',
    ].join('; '),
    estimatedSeconds: 10,
    quickScore: 14 + dev.level * 7 - dev.drachmaCost - pairs,
  }));
}

function enumerateProgress(_state: GameState, actor: PlayerState, exact = false): Candidate[] {
  const candidates: Candidate[] = [{
    message: { type: 'SKIP_PHASE' },
    instruction: 'Skip progress',
    detail: hasCard(actor, 'old-guard') ? 'Old Guard scores 4 VP for skipping.' : 'Save drachma for later.',
    estimatedSeconds: 2,
    quickScore: hasCard(actor, 'old-guard') ? 6 : -4,
  }];
  const bonusCount = (hasCard(actor, 'reformists') ? 1 : 0) + (hasDevUnlocked(actor, 'corinth-dev-3') ? 1 : 0);

  for (const primary of ['ECONOMY', 'CULTURE', 'MILITARY'] as ProgressTrackType[]) {
    const afterPrimary = virtualAdvanceProgress(actor, primary);
    if (!afterPrimary) continue;

    const bonusPlans = progressTrackPlans(afterPrimary, bonusCount, false);
    for (const bonusPlan of bonusPlans) {
      const afterBonus = bonusPlan.player;
      const maxExtra = exact
        ? Math.min(actor.philosophyTokens, remainingProgressSteps(afterBonus))
        : Math.min(actor.philosophyTokens, 3);
      const extraPlans = progressTrackPlans(afterBonus, maxExtra, true);
      for (const extraPlan of extraPlans) {
        const bonusTracks = bonusPlan.tracks.map(track => ({ track }));
        const extraTracks = extraPlan.tracks.map(track => ({ track }));
        const allTracks = [primary, ...bonusPlan.tracks, ...extraPlan.tracks];
        const scrolls = extraPlan.tracks.length;
        candidates.push({
          message: {
            type: 'PROGRESS_TRACK',
            advancement: { track: primary },
            bonusTracks: bonusTracks.length > 0 ? bonusTracks : undefined,
            extraTracks: extraTracks.length > 0 ? extraTracks : undefined,
          },
          instruction: `Advance ${joinNatural(allTracks.map(formatTrack))}`,
          detail: [
            `Pay ${progressCost(actor, primary) + bonusPlan.coinCost + extraPlan.coinCost} drachma total.`,
            bonusTracks.length > 0 ? `Use ${bonusTracks.length} bonus progress.` : null,
            scrolls > 0 ? `Spend ${scrolls} scroll${scrolls === 1 ? '' : 's'} for extra progress.` : null,
          ].filter((part): part is string => Boolean(part)).join(' '),
          estimatedSeconds: 5 + (allTracks.length - 1) * 3,
          quickScore: progressValue(actor, primary) + bonusPlan.value + extraPlan.value - scrolls,
        });
      }
    }
  }

  return candidates;
}

function enumerateAchievementChoices(actor: PlayerState): Candidate[] {
  const gloryValue = actor.knowledgeTokens.filter(t => t.tokenType === 'MAJOR').length + 1;
  return [
    {
      message: { type: 'CLAIM_ACHIEVEMENT', achievementId: '', trackChoice: 'GLORY' },
      instruction: 'Achievement: choose +1 Glory',
      detail: 'Improves end-game major-token scoring.',
      estimatedSeconds: 3,
      quickScore: gloryValue,
    },
    {
      message: { type: 'CLAIM_ACHIEVEMENT', achievementId: '', trackChoice: 'TAX' },
      instruction: 'Achievement: choose +1 Tax',
      detail: 'Improves future income.',
      estimatedSeconds: 3,
      quickScore: 2,
    },
  ];
}

function enumerateCityChoices(state: GameState, actorId: string): Candidate[] {
  const cityDraft = state.draftState?.cityDraft;
  const offeredIds = cityDraft?.offeredCities[actorId] ?? [];
  const offered = cityDraft?.allCities.filter(c => offeredIds.includes(c.id)) ?? [];
  return offered.map(city => ({
    message: { type: 'SELECT_CITY', cityId: city.id },
    instruction: `Select ${city.name}`,
    detail: 'Highest projected city value among offered choices.',
    estimatedSeconds: 5,
    quickScore: city.startingCoins + city.startingTracks.economy * 3 + city.startingTracks.culture * 3 + city.startingTracks.military * 2,
  }));
}

function enumerateDraftChoices(state: GameState, actorId: string, type: 'DRAFT_CARD' | 'PICK_BAN_CARD'): Candidate[] {
  const actor = state.players.find(p => p.playerId === actorId);
  if (type === 'DRAFT_CARD') {
    const pack = state.draftState?.politicsDraft?.packs[actorId] ?? [];
    return pack.map(card => ({
      message: { type: 'DRAFT_CARD', cardId: card.id },
      instruction: `Draft ${card.name}`,
      detail: card.description,
      estimatedSeconds: 5,
      quickScore: cardValue(card, actor, state),
    }));
  }
  const draft = state.draftState?.pickBanDraft;
  if (!draft) return [];
  const action = draft.phase;
  const unavailable = new Set([
    ...Object.values(draft.bannedCards).flatMap(cards => cards.map(c => c.id)),
    ...Object.values(draft.pickedCards).flatMap(cards => cards.map(c => c.id)),
  ]);
  return draft.allCards
    .filter(card => !unavailable.has(card.id))
    .map(card => ({
      message: { type: 'PICK_BAN_CARD', cardId: card.id, action },
      instruction: `${action === 'BAN' ? 'Ban' : 'Pick'} ${card.name}`,
      detail: card.description,
      estimatedSeconds: 5,
      quickScore: action === 'BAN' ? cardValue(card, actor, state) * 0.8 : cardValue(card, actor, state),
    }));
}

function enumerateOracleChoices(actor: PlayerState): Candidate[] {
  return actor.knowledgeTokens
    .map((token): Candidate => ({
      message: { type: 'CHOOSE_TOKEN' as const, tokenId: token.id },
      instruction: `Oracle: lose ${tokenLabel(token)}`,
      detail: 'Lose this token and gain 2 scrolls.',
      estimatedSeconds: 5,
      quickScore: -tokenValue(token),
    }))
    .sort((a, b) => b.quickScore - a.quickScore);
}

function enumerateEventProgress(actor: PlayerState, tracks: ProgressTrackType[], source: string): Candidate[] {
  const candidates: Candidate[] = [{
    message: { type: 'SKIP_PHASE' },
    instruction: `${source}: skip progress`,
    detail: 'No discounted progress is worth or affordable right now.',
    estimatedSeconds: 2,
    quickScore: -1,
  }];

  candidates.push(...tracks
    .filter(track => actor[trackField(track)] < 7)
    .filter(track => actor.coins >= discountedProgressCost(actor, track, 2))
    .map((track): Candidate => ({
      message: { type: 'EVENT_PROGRESS_TRACK', track },
      instruction: `${source}: advance ${formatTrack(track)}`,
      detail: `Pay ${discountedProgressCost(actor, track, 2)} drachma after the event discount.`,
      estimatedSeconds: 5,
      quickScore: eventProgressValue(actor, track, 2),
    })));

  return candidates;
}

function enumerateDiscardChoices(actor: PlayerState, exact = false): Candidate[] {
  const count = Math.min(2, actor.handCards.length);
  if (count <= 0) return [{ message: { type: 'SKIP_PHASE' }, instruction: 'Skip discard', detail: 'No cards to discard.', estimatedSeconds: 1, quickScore: 0 }];
  if (exact) {
    return combinations(actor.handCards, count)
      .map((discard): Candidate => ({
        message: { type: 'DISCARD_CARDS', cardIds: discard.map(c => c.id) },
        instruction: `Discard ${joinNatural(discard.map(c => c.name))}`,
        detail: 'Exact search is considering this discard set.',
        estimatedSeconds: 8,
        quickScore: -discard.reduce((sum, card) => sum + cardValue(card, actor), 0),
      }))
      .sort((a, b) => b.quickScore - a.quickScore);
  }
  const discard = [...actor.handCards].sort((a, b) => cardValue(a, actor) - cardValue(b, actor)).slice(0, count);
  return [{
    message: { type: 'DISCARD_CARDS', cardIds: discard.map(c => c.id) },
    instruction: `Discard ${joinNatural(discard.map(c => c.name))}`,
    detail: 'Lowest projected card value in hand.',
    estimatedSeconds: 8,
    quickScore: -discard.reduce((sum, card) => sum + cardValue(card, actor), 0),
  }];
}

function enumerateConquestActions(state: GameState, actor: PlayerState, exact = false): Candidate[] {
  const candidates: Candidate[] = [
    ...(exact ? [exactSkipCandidate('Conquest: skip action', 'Decline the optional Conquest action.')] : []),
    ...enumerateLegislation(state, actor),
    ...enumerateTrade(actor),
    ...enumeratePoliticsCards(state, actor, 'Conquest politics'),
    ...enumerateDevelopment(state, actor, exact),
    {
      message: { type: 'RESOLVE_ACTION' as const, actionType: 'PHILOSOPHY' as const, choices: {} },
      instruction: 'Conquest: take Philosophy',
      detail: 'Gain 1 scroll.',
      estimatedSeconds: 3,
      quickScore: 3,
    },
    {
      message: { type: 'RESOLVE_ACTION' as const, actionType: 'CULTURE' as const, choices: {} },
      instruction: 'Conquest: take Culture',
      detail: `Gain ${actor.cultureTrack} VP.`,
      estimatedSeconds: 3,
      quickScore: actor.cultureTrack,
    },
  ];
  return candidates.filter(candidate =>
    candidate.message.type !== 'RESOLVE_ACTION' || candidate.message.actionType !== 'MILITARY');
}

function rankStrategyProfiles(state: GameState, targetPlayerId: string): StrategyProfile[] {
  const player = state.players.find(p => p.playerId === targetPlayerId);
  if (!player) return STRATEGY_PROFILES;
  return [...STRATEGY_PROFILES]
    .map(profile => ({
      profile,
      score: strategyFitScore(state, player, profile),
    }))
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.profile);
}

function strategyFitScore(state: GameState, player: PlayerState, profile: StrategyProfile): number {
  const handIds = new Set(player.handCards.map(card => card.id));
  const playedIds = new Set(player.playedCards.map(card => card.id));
  const cardScore = Object.entries(profile.cardBias).reduce((sum, [cardId, value]) =>
    sum + (handIds.has(cardId) ? value : 0) + (playedIds.has(cardId) ? value * 1.4 : 0), 0);
  const majorCount = player.knowledgeTokens.filter(token => token.tokenType === 'MAJOR').length;
  const minorCount = player.knowledgeTokens.filter(token => token.tokenType === 'MINOR').length;
  const balance = Math.min(player.economyTrack, player.cultureTrack, player.militaryTrack);
  const economyFit = profile.id === 'economy_tax' || profile.id === 'cash_endgame'
    ? player.economyTrack * 2 + player.coins * 0.2 + player.taxTrack * 1.5
    : 0;
  const militaryFit = profile.id === 'military_glory'
    ? player.militaryTrack * 2 + player.troopTrack * 0.6 + majorCount * 3 + state.centralBoardTokens.filter(t => !t.explored && t.tokenType === 'MAJOR').length * 0.4
    : 0;
  const devFit = profile.id === 'development_rush'
    ? Math.max(0, 4 - player.developmentLevel) * 2 + player.philosophyTokens * 0.5
    : 0;
  const oldGuardFit = profile.id === 'old_guard' && playedIds.has('old-guard') ? 18 : 0;
  const diversificationFit = profile.id === 'diversification'
    ? balance * 2 + (handIds.has('diversification') || playedIds.has('diversification') ? 14 : 0)
    : 0;

  return cardScore
    + economyFit
    + militaryFit
    + devFit
    + oldGuardFit
    + diversificationFit
    + majorCount * profile.majorTokenBias
    + minorCount * profile.minorTokenBias
    + player.taxTrack * profile.taxBias
    + player.gloryTrack * profile.gloryBias;
}

function strategyCandidateBonus(
  state: GameState,
  actorId: string,
  candidate: Candidate,
  profile?: StrategyProfile,
): number {
  if (!profile) return 0;
  const actor = state.players.find(p => p.playerId === actorId);
  if (!actor) return 0;

  const message = candidate.message;
  let bonus = 0;
  if (message.type === 'ASSIGN_DICE') {
    bonus += message.assignments.reduce((sum, assignment) =>
      sum + (profile.actionBias[assignment.actionType] ?? 0), 0);
  }
  if (message.type === 'RESOLVE_ACTION') {
    bonus += profile.actionBias[message.actionType] ?? 0;
    const targetCardId = message.choices.targetCardId;
    if (targetCardId) bonus += profile.cardBias[targetCardId] ?? 0;
    const tokenId = message.choices.explorationTokenId;
    const secondTokenId = message.choices.secondExplorationTokenId;
    for (const id of [tokenId, secondTokenId]) {
      if (!id) continue;
      const token = state.centralBoardTokens.find(t => t.id === id);
      if (token) {
        bonus += token.tokenType === 'MAJOR' ? profile.majorTokenBias : profile.minorTokenBias;
        bonus += (token.bonusVP ?? 0) * 0.6 + (token.bonusCoins ?? 0) * 0.2;
      }
    }
  }
  if (message.type === 'PROGRESS_TRACK') {
    bonus += profile.progressBias[message.advancement.track] ?? 0;
    bonus += message.bonusTracks?.reduce((sum, track) => sum + (profile.progressBias[track.track] ?? 0), 0) ?? 0;
    bonus += message.extraTracks?.reduce((sum, track) => sum + (profile.progressBias[track.track] ?? 0), 0) ?? 0;
  }
  if (message.type === 'SKIP_PHASE' && state.currentPhase === 'PROGRESS') {
    bonus += profile.skipProgressBias + (hasCard(actor, 'old-guard') ? 8 : 0);
  }
  if (message.type === 'CLAIM_ACHIEVEMENT') {
    bonus += message.trackChoice === 'TAX' ? profile.taxBias * 2 : profile.gloryBias * 2;
  }
  if (message.type === 'EVENT_PROGRESS_TRACK') {
    bonus += profile.progressBias[message.track] ?? 0;
  }
  return bonus;
}

function endgameSuffixBonus(state: GameState, targetPlayerId: string): number {
  if (state.roundNumber < 6) return 0;
  const target = state.players.find(p => p.playerId === targetPlayerId);
  if (!target) return 0;
  return endgameSynergyScore(target, state) * (state.roundNumber - 5) * 0.08;
}

function candidateOutcomeScore(state: GameState, actorId: string, candidate: Candidate, scoringPlayerId: string): number {
  const applied = applyMessage(state, actorId, candidate.message);
  if (!applied) return -10000;
  const immediateDelta = heuristicScore(applied, scoringPlayerId) - heuristicScore(state, scoringPlayerId);
  const raceDelta = targetAchievementRaceDelta(state, applied, scoringPlayerId);
  const eventDelta = eventCompetitionOutlookScore(applied, scoringPlayerId) - eventCompetitionOutlookScore(state, scoringPlayerId);
  if (candidate.message.type === 'ASSIGN_DICE') {
    return immediateDelta
      + assignedActionPlanScore(applied, actorId, scoringPlayerId) * 0.85
      + diceAssignmentPressure(state, actorId, candidate, scoringPlayerId) * 4
      + raceDelta * 4
      + eventDelta * 3;
  }
  return immediateDelta + raceDelta * 4 + eventDelta * 3;
}

function opponentCandidateScore(state: GameState, actorId: string, candidate: Candidate, targetPlayerId: string): number {
  const applied = applyMessage(state, actorId, candidate.message);
  if (!applied) return -10000;

  const beforeActor = state.players.find(p => p.playerId === actorId);
  const afterActor = applied.players.find(p => p.playerId === actorId);
  const selfDelta = beforeActor && afterActor
    ? roughPlayerScore(afterActor, applied) - roughPlayerScore(beforeActor, state)
    : 0;
  const actorRaceDelta = achievementRaceOutlookScore(applied, actorId) - achievementRaceOutlookScore(state, actorId);
  const targetRaceDelta = achievementRaceOutlookScore(applied, targetPlayerId) - achievementRaceOutlookScore(state, targetPlayerId);
  const actorEventDelta = eventCompetitionOutlookScore(applied, actorId) - eventCompetitionOutlookScore(state, actorId);
  const targetEventDelta = eventCompetitionOutlookScore(applied, targetPlayerId) - eventCompetitionOutlookScore(state, targetPlayerId);

  return candidate.quickScore * 0.1
    + selfDelta * 0.25
    + diceAssignmentPressure(state, actorId, candidate, actorId) * 6
    + actorRaceDelta * 10
    - targetRaceDelta * 2
    + actorEventDelta * 9
    - targetEventDelta * 3;
}

function diceAssignmentPressure(state: GameState, actorId: string, candidate: Candidate, focusPlayerId: string): number {
  if (candidate.message.type !== 'ASSIGN_DICE') return 0;

  const virtual = virtualStateAfterAssignedActions(state, actorId, candidate.message.assignments.map(assignment => assignment.actionType));
  if (!virtual) return 0;

  return (achievementRaceOutlookScore(virtual, focusPlayerId) - achievementRaceOutlookScore(state, focusPlayerId))
    + (eventCompetitionOutlookScore(virtual, focusPlayerId) - eventCompetitionOutlookScore(state, focusPlayerId));
}

function virtualStateAfterAssignedActions(state: GameState, actorId: string, actions: ActionType[]): GameState | null {
  const actor = state.players.find(player => player.playerId === actorId);
  if (!actor) return null;

  let virtual = { ...actor };
  for (const action of actions) {
    switch (action) {
      case 'PHILOSOPHY':
        virtual = {
          ...virtual,
          philosophyTokens: virtual.philosophyTokens + (hasCard(virtual, 'founding-the-lyceum') ? 2 : 1),
        };
        break;
      case 'LEGISLATION':
        virtual = { ...virtual, citizenTrack: Math.min(15, virtual.citizenTrack + 3) };
        break;
      case 'CULTURE':
        virtual = {
          ...virtual,
          victoryPoints: virtual.victoryPoints + virtual.cultureTrack,
          coins: virtual.coins + (hasCard(virtual, 'stoa-poikile') ? 2 : 0),
          troopTrack: virtual.troopTrack
            + (hasCard(virtual, 'persians') ? 2 : 0)
            + (hasDevUnlocked(virtual, 'olympia-dev-2') ? 1 : 0),
          philosophyTokens: virtual.philosophyTokens + (hasDevUnlocked(virtual, 'olympia-dev-2') ? 1 : 0),
        };
        break;
      case 'TRADE':
        virtual = {
          ...virtual,
          coins: virtual.coins + virtual.economyTrack + 1 + (hasCard(virtual, 'diolkos') ? 1 : 0),
          troopTrack: virtual.troopTrack
            + (hasCard(virtual, 'diolkos') ? 1 : 0)
            + (hasCard(virtual, 'foreign-supplies') ? 2 : 0),
          victoryPoints: virtual.victoryPoints
            + (hasCard(virtual, 'diolkos') ? 1 : 0)
            + (hasCard(virtual, 'lighthouse') ? 3 : 0)
            + (hasDevUnlocked(virtual, 'miletus-dev-3') ? 3 : 0),
        };
        break;
      case 'MILITARY':
        virtual = { ...virtual, troopTrack: virtual.troopTrack + virtual.militaryTrack };
        break;
      case 'POLITICS': {
        const playable = virtual.handCards.find(card => canPlayPoliticsCard(virtual, card));
        if (playable) {
          virtual = {
            ...virtual,
            handCards: virtual.handCards.filter(card => card.id !== playable.id),
            playedCards: [...virtual.playedCards, playable],
            coins: virtual.coins - playable.cost + (hasDevUnlocked(virtual, 'athens-dev-2') ? 2 : 0),
            victoryPoints: virtual.victoryPoints + (hasDevUnlocked(virtual, 'athens-dev-2') ? 3 : 0),
            troopTrack: virtual.troopTrack + (hasDevUnlocked(virtual, 'athens-dev-3') ? 2 : 0),
          };
        }
        break;
      }
      case 'DEVELOPMENT':
        if (virtual.cityId === 'argos' && virtual.developmentLevel === 1) {
          virtual = { ...virtual, citizenTrack: Math.min(15, virtual.citizenTrack + 5) };
        }
        if (virtual.cityId === 'miletus' && virtual.developmentLevel === 0) {
          virtual = { ...virtual, economyTrack: Math.min(7, virtual.economyTrack + 1) };
        }
        break;
    }
  }

  return {
    ...state,
    players: state.players.map(player => player.playerId === actorId ? virtual : player),
  };
}

function assignedActionPlanScore(state: GameState, actorId: string, scoringPlayerId: string): number {
  const actor = state.players.find(p => p.playerId === actorId);
  if (!actor || !actor.actionSlots.some(slot => slot !== null && !slot.resolved)) return 0;

  const staged: GameState = {
    ...state,
    currentPhase: 'ACTIONS',
    turnOrder: [actorId, ...state.turnOrder.filter(pid => pid !== actorId)],
    pendingDecisions: [{
      playerId: actorId,
      decisionType: 'RESOLVE_ACTION',
      timeoutAt: Date.now() + 60_000,
      options: null as unknown,
    }],
  };
  let current = staged;
  const before = heuristicScore(staged, scoringPlayerId);

  for (let step = 0; step < 4; step++) {
    const currentActor = current.players.find(p => p.playerId === actorId);
    if (!currentActor || !nextAction(currentActor)) break;

    const candidates = enumerateActionResolution(current, currentActor);
    const usable = candidates.length > 0
      ? candidates
      : fallbackCandidates(current, actorId, 'RESOLVE_ACTION');
    let best: { state: GameState; score: number } | null = null;

    for (const actionCandidate of usable.slice(0, 8)) {
      const applied = applyMessage(current, actorId, actionCandidate.message);
      if (!applied) continue;
      const score = heuristicScore(applied, scoringPlayerId) + actionCandidate.quickScore * 0.05;
      if (!best || score > best.score) {
        best = { state: applied, score };
      }
    }

    if (!best) break;
    current = best.state;
  }

  return Math.max(0, heuristicScore(current, scoringPlayerId) - before);
}

function applyMessage(state: GameState, actorId: string, message: ClientMessage): GameState | null {
  try {
    if (message.type === 'ACTIVATE_DEV') {
      const before = stateSignature(state);
      const updated = activateDev(cloneGameState(state), actorId, message.devId);
      return stateSignature(updated) === before ? null : updated;
    }

    const engine = new GameEngine(state.draftMode);
    const machine = engine.getStateMachine();
    machine.currentPhase = state.currentPhase;
    machine.roundNumber = state.roundNumber;
    const result = engine.handlePlayerDecision(cloneGameState(state), actorId, message);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

function autoResolve(state: GameState, actorId: string): GameState {
  try {
    const engine = new GameEngine(state.draftMode);
    const machine = engine.getStateMachine();
    machine.currentPhase = state.currentPhase;
    machine.roundNumber = state.roundNumber;
    return engine.handleTimeout(cloneGameState(state), actorId);
  } catch {
    return state;
  }
}

function advancePhase(state: GameState): GameState {
  try {
    const engine = new GameEngine(state.draftMode);
    const machine = engine.getStateMachine();
    machine.currentPhase = state.currentPhase;
    machine.roundNumber = state.roundNumber;
    return engine.advancePhase(cloneGameState(state));
  } catch {
    return state;
  }
}

function buildMove(
  state: GameState,
  actorId: string,
  decisionType: LiveSolverMove['decisionType'],
  candidate: Candidate,
): LiveSolverMove {
  const actor = state.players.find(p => p.playerId === actorId);
  return {
    round: state.roundNumber,
    phase: state.currentPhase,
    playerId: actorId,
    playerName: actor?.playerName ?? actorId,
    decisionType,
    instruction: candidate.instruction,
    detail: candidate.detail,
    message: candidate.message,
    estimatedSeconds: candidate.estimatedSeconds,
  };
}

function buildAutoDisplayMove(
  state: GameState,
  targetPlayerId: string,
  display: GameState['pendingDecisions'][number],
): LiveSolverMove | null {
  const options = display.options;
  if (!options || typeof options !== 'object') return null;
  const actionType = (options as { actionType?: ActionType; midAction?: boolean }).actionType;
  const isMidAction = (options as { midAction?: boolean }).midAction;
  if (!isMidAction || !actionType) return null;

  const logEntry = [...state.gameLog].reverse().find(entry =>
    entry.playerId === targetPlayerId
    && entry.roundNumber === state.roundNumber
    && entry.phase === 'ACTIONS'
    && (entry.details as { actionType?: ActionType }).actionType === actionType);
  if (!logEntry) return null;

  const actor = state.players.find(p => p.playerId === targetPlayerId);
  return {
    round: state.roundNumber,
    phase: 'ACTIONS',
    playerId: targetPlayerId,
    playerName: actor?.playerName ?? targetPlayerId,
    decisionType: 'RESOLVE_ACTION',
    instruction: `Resolve ${ACTION_LABELS[actionType]}`,
    detail: actionType === 'PHILOSOPHY'
      ? 'Gain 1 scroll.'
      : `Gain ${actor?.cultureTrack ?? 0} VP.`,
    message: null,
    estimatedSeconds: 1,
  };
}

function hasEquivalentMove(moves: LiveSolverMove[], move: LiveSolverMove): boolean {
  return moves.some(existing =>
    existing.round === move.round
    && existing.phase === move.phase
    && existing.playerId === move.playerId
    && existing.decisionType === move.decisionType
    && existing.instruction === move.instruction);
}

function groupMovesByRound(moves: LiveSolverMove[]): LiveSolverRoundPlan[] {
  const map = new Map<number, LiveSolverMove[]>();
  for (const move of moves) {
    const roundMoves = map.get(move.round) ?? [];
    roundMoves.push(move);
    map.set(move.round, roundMoves);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([round, roundMoves]) => ({ round, moves: roundMoves }));
}

function scoreNode(node: SearchNode, targetPlayerId: string): SearchNode {
  return { ...node, score: heuristicScore(node.state, targetPlayerId) };
}

function heuristicScore(state: GameState, targetPlayerId: string): number {
  const cacheKey = activeHeuristicCache
    ? `${targetPlayerId}|${state.currentPhase === 'GAME_OVER' ? exactStateSignature(state) : stateSignature(state)}`
    : null;
  if (cacheKey) {
    const cached = activeHeuristicCache?.get(cacheKey);
    if (cached !== undefined) return cached;
  }

  let score: number;
  if (state.currentPhase === 'GAME_OVER') {
    score = solvedStateScore(state, targetPlayerId);
    if (cacheKey) activeHeuristicCache?.set(cacheKey, score);
    return score;
  }

  const target = state.players.find(p => p.playerId === targetPlayerId);
  if (!target) return -Infinity;
  const targetScore = roughPlayerScore(target, state);
  const opponentScore = Math.max(0, ...state.players
    .filter(p => p.playerId !== targetPlayerId)
    .map(player => roughPlayerScore(player, state)));
  const phaseProgress = Math.max(0, PHASE_ORDER.indexOf(state.currentPhase));
  score = (targetScore - opponentScore) * 3 + targetScore + endgameSynergyScore(target, state) + state.roundNumber * 0.05 + phaseProgress * 0.01;
  if (cacheKey) activeHeuristicCache?.set(cacheKey, score);
  return score;
}

function solvedNodeScore(node: SearchNode, targetPlayerId: string): number {
  return solvedStateScore(node.state, targetPlayerId);
}

function solvedStateScore(state: GameState, targetPlayerId: string): number {
  const projection = projectScores(state, targetPlayerId);
  const target = projection.scores.find(score => score.playerId === targetPlayerId);
  const margin = projection.margin ?? -999;
  return margin * 1000 + (target?.projectedTotal ?? 0);
}

function roughPlayerScore(player: PlayerState, state?: GameState): number {
  const remainingRounds = state ? Math.max(0, 10 - state.roundNumber) : 5;
  const majors = player.knowledgeTokens.filter(t => t.tokenType === 'MAJOR').length;
  const expectedMajorUpside = Math.min(
    4,
    Math.max(0, player.militaryTrack - 1) * 0.35
      + player.troopTrack * 0.06
      + (state ? state.centralBoardTokens.filter(t => !t.explored && t.tokenType === 'MAJOR').length * 0.04 : 0),
  );
  const currentFinalish =
    player.victoryPoints
    + calculateDevEndGameScore(player)
    + player.gloryTrack * majors
    + player.playedCards.reduce((sum, card) => sum + roughEndGameCardScore(card, player), 0);
  const playedEngineValue = player.playedCards.reduce(
    (sum, card) => sum + roughPlayedCardUtility(card, player, state, remainingRounds),
    0,
  );
  return currentFinalish
    + playedEngineValue
    + player.coins * 0.25
    + player.philosophyTokens * 0.8
    + player.citizenTrack * 0.18
    + player.economyTrack * 1.4
    + player.cultureTrack * 1.6
    + player.militaryTrack * 1.25
    + player.taxTrack * (0.45 + remainingRounds * 0.22)
    + player.gloryTrack * (0.8 + expectedMajorUpside * 0.65)
    + player.troopTrack * 0.45
    + player.knowledgeTokens.reduce((sum, token) => sum + tokenValue(token) * (token.tokenType === 'MAJOR' ? 0.42 : 0.24), 0)
    + player.handCards.reduce((sum, card) => sum + handCardPotential(card, player) * 0.04, 0)
    + (state ? endgameSynergyScore(player, state) * 0.35 : 0)
    - Math.max(0, player.handCards.length - 4) * 0.45;
}

function endgameSynergyScore(player: PlayerState, state: GameState): number {
  const majors = player.knowledgeTokens.filter(token => token.tokenType === 'MAJOR').length;
  const minors = player.knowledgeTokens.filter(token => token.tokenType === 'MINOR').length;
  const lowestCoreTrack = Math.min(player.economyTrack, player.cultureTrack, player.militaryTrack);
  const playedIds = new Set(player.playedCards.map(card => card.id));
  const handIds = new Set(player.handCards.map(card => card.id));
  const cardIds = new Set([...playedIds, ...handIds]);

  let score = 0;
  if (cardIds.has('old-guard')) {
    score += (10 - state.roundNumber) * 1.2 + (hasProgressPlan(player) ? -1 : 3);
  }
  if (cardIds.has('diversification')) {
    score += lowestCoreTrack * 2.5
      + Math.max(0, 7 - Math.max(player.economyTrack, player.cultureTrack, player.militaryTrack)) * 0.4;
  }
  if (cardIds.has('bank')) score += Math.floor(player.coins / 2) * 1.4 + player.economyTrack * 0.5;
  if (cardIds.has('gold-reserve')) score += player.economyTrack * 1.8;
  if (cardIds.has('heavy-taxes')) score += player.taxTrack * 1.9;
  if (cardIds.has('proskenion')) score += player.citizenTrack * 0.9;
  if (cardIds.has('austerity')) score += Math.max(0, player.handCards.length - 1) * 1.6;
  if (cardIds.has('hall-of-statues')) score += player.knowledgeTokens.length * 1.5;
  if (cardIds.has('central-government')) score += (player.playedCards.length + 1) * 1.5;
  score += player.gloryTrack * majors * 0.9;
  score += majors * 1.1 + minors * 0.3;
  score += calculateDevEndGameScore(player) * 0.6;
  return score;
}

function roughEndGameCardScore(card: PoliticsCard, player: PlayerState): number {
  if (card.type !== 'END_GAME' || !card.endGameScoring) return 0;
  try {
    return card.endGameScoring.calculate(player);
  } catch {
    return 0;
  }
}

function roughPlayedCardUtility(
  card: PoliticsCard,
  player: PlayerState,
  state: GameState | undefined,
  remainingRounds: number,
): number {
  if (card.type !== 'ONGOING') return 0;
  return politicsCardPlayerValue(card, player, state, remainingRounds) * 0.75;
}

function projectScores(state: GameState, targetPlayerId: string): Projection {
  const board = state.currentPhase === 'GAME_OVER' && state.finalScores
    ? state.finalScores
    : calculateFinalScores(state);
  const scores = board.rankings.map(score => ({
    playerId: score.playerId,
    playerName: score.playerName,
    projectedTotal: score.totalPoints,
    rank: score.rank,
  }));
  const target = scores.find(score => score.playerId === targetPlayerId);
  const bestOpponent = scores
    .filter(score => score.playerId !== targetPlayerId)
    .sort((a, b) => b.projectedTotal - a.projectedTotal)[0];
  return {
    scores,
    margin: target && bestOpponent ? target.projectedTotal - bestOpponent.projectedTotal : null,
  };
}

function targetAchievementRaceDelta(before: GameState, after: GameState, targetPlayerId: string): number {
  return achievementRaceOutlookScore(after, targetPlayerId) - achievementRaceOutlookScore(before, targetPlayerId);
}

function achievementRaceOutlookScore(state: GameState, playerId: string): number {
  const player = state.players.find(p => p.playerId === playerId);
  if (!player) return 0;

  let score = 0;
  for (const achievement of state.availableAchievements) {
    const playerRound = earliestAchievementReachRound(state, player, achievement.id);
    const opponentRound = Math.min(
      Infinity,
      ...state.players
        .filter(p => p.playerId !== playerId && p.isConnected && !p.hasFlagged)
        .map(p => earliestAchievementReachRound(state, p, achievement.id) ?? Infinity),
    );

    if (playerRound !== null && playerRound <= opponentRound) {
      score += playerRound === state.roundNumber ? 1.4 : 0.45;
    } else if (opponentRound !== Infinity) {
      score -= opponentRound === state.roundNumber ? 2.2 : 0.9;
    }
  }
  return score;
}

function earliestAchievementReachRound(state: GameState, player: PlayerState, achievementId: string): number | null {
  if (state.roundNumber > activeAchievementHorizonRound) return null;
  if (achievementReached(player, achievementId)) return state.roundNumber;
  if (state.roundNumber >= activeAchievementHorizonRound || state.roundNumber >= 9) return null;
  return canReachAchievementByNextRound(state, player, achievementId) ? state.roundNumber + 1 : null;
}

function achievementReached(player: PlayerState, achievementId: string): boolean {
  switch (achievementId) {
    case 'ach-10vp': return player.victoryPoints >= 10;
    case 'ach-12citizens': return player.citizenTrack >= 12;
    case 'ach-4economy': return player.economyTrack >= 4;
    case 'ach-3cards': return player.playedCards.length >= 3;
    case 'ach-6troops': return player.troopTrack >= 6;
    default: return false;
  }
}

function canReachAchievementByNextRound(state: GameState, player: PlayerState, achievementId: string): boolean {
  switch (achievementId) {
    case 'ach-10vp':
      return player.victoryPoints + oneRoundVpPotential(state, player) >= 10;
    case 'ach-12citizens':
      return player.citizenTrack + oneRoundCitizenPotential(state, player) >= 12;
    case 'ach-4economy':
      return player.economyTrack + oneRoundEconomyProgressPotential(player) >= 4;
    case 'ach-3cards':
      return player.playedCards.length + oneRoundPoliticsPlayPotential(player) >= 3;
    case 'ach-6troops':
      return player.troopTrack + oneRoundTroopPotential(player) >= 6;
    default:
      return false;
  }
}

function oneRoundVpPotential(state: GameState, player: PlayerState): number {
  const culture = player.cultureTrack;
  const playableImmediate = player.handCards
    .filter(card => canPlayPoliticsCard(player, card))
    .reduce((best, card) => {
      if (card.id === 'colossus-of-rhodes') return Math.max(best, 10);
      if (card.id === 'tunnel-of-eupalinos') return Math.max(best, 6);
      if (card.id === 'lighthouse') return Math.max(best, 3);
      return best;
    }, 0);
  const eventSwing = COMPETITIVE_TROOP_EVENTS.has(state.currentEvent?.id ?? '') ? Math.max(0, eventCompetitionOutlookScore(state, player.playerId)) : 0;
  return culture + playableImmediate + eventSwing;
}

function oneRoundCitizenPotential(state: GameState, player: PlayerState): number {
  let potential = 3; // Legislation is the common reachable citizen burst.
  if (player.cityId === 'argos' && player.developmentLevel === 1) potential = Math.max(potential, 5);
  if (state.currentEvent?.id === 'conscripting-troops' && eventCompetitionOutlookScore(state, player.playerId) > 0) {
    potential += 3;
  }
  return potential;
}

function oneRoundEconomyProgressPotential(player: PlayerState): number {
  let potential = player.coins >= progressCost(player, 'ECONOMY') ? 1 : 0;
  if (player.philosophyTokens > 0 && player.coins >= progressCost(player, 'ECONOMY')) potential += 1;
  if (hasCard(player, 'reformists') || hasDevUnlocked(player, 'corinth-dev-3')) potential += 1;
  if (player.cityId === 'miletus' && player.developmentLevel <= 1) potential += 1;
  return Math.min(3, potential);
}

function oneRoundPoliticsPlayPotential(player: PlayerState): number {
  const playable = player.handCards.filter(card => canPlayPoliticsCard(player, card)).length;
  return Math.min(1, playable);
}

function oneRoundTroopPotential(player: PlayerState): number {
  let potential = player.militaryTrack;
  if (hasCard(player, 'persians')) potential += 2;
  if (hasCard(player, 'diolkos')) potential += 1;
  if (hasCard(player, 'foreign-supplies')) potential += 2;
  if (hasCard(player, 'stadion')) potential += 2;
  if (hasDevUnlocked(player, 'olympia-dev-2')) potential += 1;
  if (player.cityId === 'argos' && player.developmentLevel <= 2) potential += 2;
  for (const card of player.handCards) {
    if (!canPlayPoliticsCard(player, card)) continue;
    if (card.id === 'greek-fire') potential += 4;
    if (card.id === 'mercenary-recruitment') potential += player.economyTrack;
  }
  return potential;
}

function eventCompetitionOutlookScore(state: GameState, playerId: string): number {
  const eventId = state.currentEvent?.id;
  if (!eventId || !COMPETITIVE_TROOP_EVENTS.has(eventId)) return 0;

  const contenders = state.players.filter(p => p.isConnected && !p.hasFlagged);
  const player = contenders.find(p => p.playerId === playerId);
  if (!player || contenders.length === 0) return 0;

  const highest = Math.max(...contenders.map(p => p.troopTrack));
  const lowest = Math.min(...contenders.map(p => p.troopTrack));
  const isHighest = player.troopTrack === highest;
  const isLowest = player.troopTrack === lowest;

  switch (eventId) {
    case 'origin-of-academy':
      return (isHighest ? 1.2 : 0) - (isLowest ? Math.min(5, player.philosophyTokens) * 0.8 : 0);
    case 'conscripting-troops':
      return (isHighest ? 2.2 : 0) - (isLowest ? 2.2 : 0);
    case 'eleusinian-mysteries':
      return (isHighest ? 4 : 0) - (isLowest ? 4 : 0);
    case 'military-victory':
      return isHighest ? bestDiscountedEventProgressValue(player) : 0;
    case 'prosperity':
      return isHighest ? (enumeratePoliticsCards(state, player, 'Prosperity politics')[0]?.quickScore ?? 0) * 0.35 : 0;
    case 'savior-of-greece':
      return (isHighest ? 0.7 : 0) - (isLowest ? 0.7 : 0);
    case 'thirty-tyrants':
      return (isHighest ? state.politicsDeck.slice(0, 2).reduce((sum, card) => sum + handCardPotential(card, player) * 0.08, 1.5) : 0)
        - (isLowest ? player.handCards.slice(-2).reduce((sum, card) => sum + Math.max(1, handCardPotential(card, player) * 0.12), 0) : 0);
    default:
      return 0;
  }
}

function bestDiscountedEventProgressValue(player: PlayerState): number {
  return (['ECONOMY', 'CULTURE', 'MILITARY'] as ProgressTrackType[])
    .filter(track => player[trackField(track)] < 7)
    .filter(track => player.coins >= discountedProgressCost(player, track, 2))
    .reduce((best, track) => Math.max(best, eventProgressValue(player, track, 2)), 0);
}

function canPlayPoliticsCard(player: PlayerState, card: PoliticsCard): boolean {
  return player.coins >= card.cost && knowledgeShortfall(player, card.knowledgeRequirement) * 2 <= player.philosophyTokens;
}

function rankAndPruneNodes(nodes: SearchNode[], limit: number, targetPlayerId: string): SearchNode[] {
  const bySignature = new Map<string, SearchNode>();
  for (const node of nodes) {
    const scored = scoreNode(node, targetPlayerId);
    const key = stateSignature(scored.state);
    const existing = bySignature.get(key);
    if (!existing || scored.score > existing.score) bySignature.set(key, scored);
  }

  const sorted = Array.from(bySignature.values()).sort((a, b) => b.score - a.score);
  const accepted: SearchNode[] = [];
  const dominanceBuckets = new Map<string, SearchNode[]>();

  for (const node of sorted) {
    const key = dominanceKey(node.state, targetPlayerId);
    const bucket = dominanceBuckets.get(key) ?? [];
    if (bucket.some(existing => dominatesForTarget(existing.state, node.state, targetPlayerId))) continue;

    dominanceBuckets.set(key, [...bucket, node].slice(0, 12));
    accepted.push(node);
    if (accepted.length >= limit * 2) break;
  }

  return diversify(accepted, limit);
}

function dominanceKey(state: GameState, targetPlayerId: string): string {
  const target = state.players.find(player => player.playerId === targetPlayerId);
  return JSON.stringify({
    phase: state.currentPhase,
    round: state.roundNumber,
    pending: state.pendingDecisions.map(d => `${d.playerId}:${d.decisionType}`),
    target: target ? {
      cityId: target.cityId,
      developmentLevel: target.developmentLevel,
      economyTrack: target.economyTrack,
      cultureTrack: target.cultureTrack,
      militaryTrack: target.militaryTrack,
      handCards: target.handCards.map(card => card.id).sort(),
      playedCards: target.playedCards.map(card => card.id).sort(),
      knowledge: exactKnowledgeSignature(target.knowledgeTokens),
      actionSlots: target.actionSlots.map(slot => slot ? `${slot.actionType}:${slot.resolved ? 1 : 0}` : '-'),
    } : null,
    event: state.currentEvent?.id ?? null,
    achievements: state.availableAchievements.map(achievement => achievement.id),
    deckTop: state.politicsDeck.slice(0, 3).map(card => card.id),
    tokens: state.centralBoardTokens.filter(token => !token.explored).map(token => token.id).slice(0, 10),
  });
}

function dominatesForTarget(a: GameState, b: GameState, targetPlayerId: string): boolean {
  const left = a.players.find(player => player.playerId === targetPlayerId);
  const right = b.players.find(player => player.playerId === targetPlayerId);
  if (!left || !right) return false;
  const leftValues = [
    left.victoryPoints,
    left.coins,
    left.philosophyTokens,
    left.taxTrack,
    left.gloryTrack,
    left.troopTrack,
    left.citizenTrack,
  ];
  const rightValues = [
    right.victoryPoints,
    right.coins,
    right.philosophyTokens,
    right.taxTrack,
    right.gloryTrack,
    right.troopTrack,
    right.citizenTrack,
  ];
  return leftValues.every((value, index) => value >= rightValues[index])
    && leftValues.some((value, index) => value > rightValues[index]);
}

function diversify(nodes: SearchNode[], limit: number): SearchNode[] {
  const selected: SearchNode[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const key = stateSignature(node.state);
    if (seen.has(key) && selected.length >= Math.ceil(limit / 2)) continue;
    seen.add(key);
    selected.push(node);
    if (selected.length >= limit) break;
  }
  return selected;
}

function stateSignature(state: GameState): string {
  return JSON.stringify({
    phase: state.currentPhase,
    round: state.roundNumber,
    pending: state.pendingDecisions.map(d => `${d.playerId}:${d.decisionType}`),
    progressSubmissions: progressSubmissionSignature(state),
    players: state.players.map(p => [
      p.playerId, p.cityId, p.developmentLevel, p.coins, p.victoryPoints, p.economyTrack, p.cultureTrack, p.militaryTrack,
      p.taxTrack, p.gloryTrack, p.troopTrack, p.citizenTrack, p.philosophyTokens,
      p.diceRoll?.join(',') ?? '',
      p.actionSlots.map(s => s ? `${s.actionType}:${s.assignedDie}:${s.resolved ? 1 : 0}` : '-').join(','),
      p.handCards.map(c => c.id).join(','),
      p.playedCards.map(c => c.id).join(','),
      p.knowledgeTokens.map(t => t.id).join(','),
    ]),
    deck: state.politicsDeck.slice(0, 4).map(c => c.id),
    tokens: state.centralBoardTokens.filter(t => !t.explored).slice(0, 6).map(t => t.id),
  });
}

function exactStateSignature(state: GameState): string {
  return JSON.stringify({
    phase: state.currentPhase,
    round: state.roundNumber,
    progressSubmissions: progressSubmissionSignature(state),
    startPlayerId: state.startPlayerId,
    turnOrder: state.turnOrder,
    currentEvent: state.currentEvent?.id ?? null,
    eventDeck: state.eventDeck.map(card => card.id),
    predeterminedDice: state.predeterminedDice,
    pending: state.pendingDecisions.map(decision => ({
      playerId: decision.playerId,
      decisionType: decision.decisionType,
      options: decision.options ?? null,
    })),
    players: state.players.map(player => ({
      playerId: player.playerId,
      playerName: player.playerName,
      cityId: player.cityId,
      isConnected: player.isConnected,
      hasFlagged: player.hasFlagged,
      developmentLevel: player.developmentLevel,
      coins: player.coins,
      victoryPoints: player.victoryPoints,
      economyTrack: player.economyTrack,
      cultureTrack: player.cultureTrack,
      militaryTrack: player.militaryTrack,
      taxTrack: player.taxTrack,
      gloryTrack: player.gloryTrack,
      troopTrack: player.troopTrack,
      citizenTrack: player.citizenTrack,
      philosophyTokens: player.philosophyTokens,
      diceRoll: player.diceRoll,
      actionSlots: player.actionSlots.map(slot => slot
        ? {
            actionType: slot.actionType,
            assignedDie: slot.assignedDie,
            citizenCost: slot.citizenCost,
            resolved: slot.resolved,
          }
        : null),
      handCards: player.handCards.map(card => card.id),
      playedCards: player.playedCards.map(card => card.id),
      knowledgeTokens: exactKnowledgeSignature(player.knowledgeTokens),
    })),
    politicsDeck: state.politicsDeck.map(card => card.id),
    centralBoardTokens: state.centralBoardTokens.map(token => ({
      id: token.id,
      color: token.color,
      tokenType: token.tokenType,
      militaryRequirement: token.militaryRequirement ?? null,
      skullValue: token.skullValue ?? null,
      bonusVP: token.bonusVP ?? null,
      bonusCoins: token.bonusCoins ?? null,
      isPersepolis: token.isPersepolis ?? false,
      explored: token.explored ?? false,
    })),
    availableAchievements: state.availableAchievements.map(achievement => achievement.id),
    claimedAchievements: Array.from(state.claimedAchievements.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([playerId, achievements]) => [playerId, achievements.map(achievement => achievement.id)]),
    draftMode: state.draftMode,
    draftState: state.draftState ? {
      cityDraft: state.draftState.cityDraft ? {
        pickOrder: state.draftState.cityDraft.pickOrder,
        currentPickerIndex: state.draftState.cityDraft.currentPickerIndex,
        offeredCities: state.draftState.cityDraft.offeredCities,
        remainingPool: state.draftState.cityDraft.remainingPool.map(city => city.id),
        selections: state.draftState.cityDraft.selections,
      } : null,
      politicsDraft: state.draftState.politicsDraft ? {
        packs: Object.fromEntries(Object.entries(state.draftState.politicsDraft.packs)
          .map(([playerId, cards]) => [playerId, cards.map(card => card.id)])),
        draftRound: state.draftState.politicsDraft.draftRound,
        selectedCards: Object.fromEntries(Object.entries(state.draftState.politicsDraft.selectedCards)
          .map(([playerId, cards]) => [playerId, cards.map(card => card.id)])),
        waitingFor: state.draftState.politicsDraft.waitingFor,
        passOrder: state.draftState.politicsDraft.passOrder,
      } : null,
      pickBanDraft: state.draftState.pickBanDraft ? {
        phase: state.draftState.pickBanDraft.phase,
        currentTurnIndex: state.draftState.pickBanDraft.currentTurnIndex,
        turnOrder: state.draftState.pickBanDraft.turnOrder,
        allCards: state.draftState.pickBanDraft.allCards.map(card => card.id),
        bansPerPlayer: state.draftState.pickBanDraft.bansPerPlayer,
        picksPerPlayer: state.draftState.pickBanDraft.picksPerPlayer,
        bannedCards: Object.fromEntries(Object.entries(state.draftState.pickBanDraft.bannedCards)
          .map(([playerId, cards]) => [playerId, cards.map(card => card.id)])),
        pickedCards: Object.fromEntries(Object.entries(state.draftState.pickBanDraft.pickedCards)
          .map(([playerId, cards]) => [playerId, cards.map(card => card.id)])),
      } : null,
    } : null,
  });
}

function progressSubmissionSignature(state: GameState): Array<[string, string[], boolean, boolean]> {
  return Object.entries(state.progressSubmissions ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([playerId, submission]): [string, string[], boolean, boolean] => [
      playerId,
      [
        submission.advancement?.track,
        ...(submission.bonusTracks?.map(track => `B:${track.track}`) ?? []),
        ...(submission.extraTracks?.map(track => `E:${track.track}`) ?? []),
      ].filter((track): track is string => Boolean(track)),
      Boolean(submission.skipped),
      Boolean(submission.auto),
    ]);
}

function exactKnowledgeSignature(tokens: KnowledgeToken[]): string[] {
  return tokens
    .map(token => [
      token.color,
      token.tokenType,
      token.militaryRequirement ?? '',
      token.skullValue ?? '',
      token.bonusVP ?? '',
      token.bonusCoins ?? '',
      token.isPersepolis ? 'P' : '',
    ].join(':'))
    .sort();
}

function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map(clonePlayer),
    predeterminedDice: Object.fromEntries(Object.entries(state.predeterminedDice).map(([round, playerDice]) => [
      round,
      Object.fromEntries(Object.entries(playerDice).map(([pid, dice]) => [pid, [...dice]])),
    ])),
    eventDeck: [...state.eventDeck],
    politicsDeck: [...state.politicsDeck],
    centralBoardTokens: state.centralBoardTokens.map(t => ({ ...t })),
    availableAchievements: [...state.availableAchievements],
    claimedAchievements: new Map(Array.from(state.claimedAchievements.entries()).map(([pid, achievements]) => [pid, [...achievements]])),
    pendingDecisions: state.pendingDecisions.map(d => ({ ...d })),
    progressSubmissions: cloneProgressSubmissions(state.progressSubmissions),
    disconnectedPlayers: new Map(state.disconnectedPlayers),
    draftState: state.draftState ? {
      cityDraft: state.draftState.cityDraft ? {
        ...state.draftState.cityDraft,
        offeredCities: Object.fromEntries(Object.entries(state.draftState.cityDraft.offeredCities).map(([pid, ids]) => [pid, [...ids]])),
        remainingPool: [...state.draftState.cityDraft.remainingPool],
        selections: { ...state.draftState.cityDraft.selections },
        allCities: [...state.draftState.cityDraft.allCities],
      } : null,
      politicsDraft: state.draftState.politicsDraft ? {
        ...state.draftState.politicsDraft,
        packs: Object.fromEntries(Object.entries(state.draftState.politicsDraft.packs).map(([pid, cards]) => [pid, [...cards]])),
        selectedCards: Object.fromEntries(Object.entries(state.draftState.politicsDraft.selectedCards).map(([pid, cards]) => [pid, [...cards]])),
        waitingFor: [...state.draftState.politicsDraft.waitingFor],
        passOrder: [...state.draftState.politicsDraft.passOrder],
      } : null,
      pickBanDraft: state.draftState.pickBanDraft ? {
        ...state.draftState.pickBanDraft,
        allCards: [...state.draftState.pickBanDraft.allCards],
        bannedCards: Object.fromEntries(Object.entries(state.draftState.pickBanDraft.bannedCards).map(([pid, cards]) => [pid, [...cards]])),
        pickedCards: Object.fromEntries(Object.entries(state.draftState.pickBanDraft.pickedCards).map(([pid, cards]) => [pid, [...cards]])),
        turnOrder: [...state.draftState.pickBanDraft.turnOrder],
      } : null,
    } : null,
    finalScores: state.finalScores ? {
      winnerId: state.finalScores.winnerId,
      rankings: state.finalScores.rankings.map(r => ({ ...r, breakdown: { ...r.breakdown, detailedSources: [...r.breakdown.detailedSources] } })),
    } : null,
  };
}

function cloneProgressSubmissions(
  submissions: GameState['progressSubmissions'],
): GameState['progressSubmissions'] {
  if (!submissions) return undefined;
  return Object.fromEntries(Object.entries(submissions).map(([playerId, submission]) => [
    playerId,
    {
      ...submission,
      advancement: submission.advancement ? { ...submission.advancement } : undefined,
      bonusTracks: submission.bonusTracks?.map(track => ({ ...track })),
      extraTracks: submission.extraTracks?.map(track => ({ ...track })),
    },
  ]));
}

function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    knowledgeTokens: player.knowledgeTokens.map(t => ({ ...t })),
    handCards: [...player.handCards],
    playedCards: [...player.playedCards],
    diceRoll: player.diceRoll ? [...player.diceRoll] : null,
    diceRollHistory: [...(player.diceRollHistory ?? [])],
    actionSlots: player.actionSlots.map(slot => slot ? { ...slot } : null) as PlayerState['actionSlots'],
  };
}

function nextAction(player: PlayerState): ActionType | null {
  return player.actionSlots
    .filter((slot): slot is NonNullable<typeof slot> => slot !== null && !slot.resolved)
    .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType])[0]?.actionType ?? null;
}

function actionLikelyUseful(state: GameState, actor: PlayerState, action: ActionType): boolean {
  if (action === 'LEGISLATION') return state.politicsDeck.length > 0;
  if (action === 'POLITICS') return actor.handCards.length > 0;
  if (action === 'DEVELOPMENT') return actor.developmentLevel < 4;
  return true;
}

function actionPriority(state: GameState, actor: PlayerState, action: ActionType): number {
  switch (action) {
    case 'PHILOSOPHY':
      return 2.5 + scrollDemand(actor) * 0.8;
    case 'LEGISLATION': {
      const drawValue = state.politicsDeck
        .slice(0, 2)
        .reduce((best, card) => Math.max(best, handCardPotential(card, actor)), 0);
      const handPenalty = Math.max(0, actor.handCards.length - 2) * 2.4;
      return 4 + Math.max(0, drawValue * 0.16 - handPenalty);
    }
    case 'CULTURE':
      return 2 + actor.cultureTrack + actionTriggerValue(state, actor, 'CULTURE');
    case 'TRADE':
      return 4 + actor.economyTrack + tradeKnowledgeValue(actor);
    case 'MILITARY':
      return 4 + actor.militaryTrack + bestExplorationValue(state, actor) * 0.45;
    case 'POLITICS': {
      const bestPlayable = enumeratePoliticsCards(state, actor, 'Politics')[0];
      return bestPlayable ? 8 + bestPlayable.quickScore * 0.42 : 1 + actor.handCards.length * 0.4;
    }
    case 'DEVELOPMENT': {
      const bestDevelopment = enumerateDevelopment(state, actor)[0];
      return bestDevelopment ? 9 + bestDevelopment.quickScore * 0.35 : 1;
    }
  }
}

function cardValue(card: PoliticsCard, player?: PlayerState, state?: GameState): number {
  const requirementFlex =
    card.knowledgeRequirement.green + card.knowledgeRequirement.blue + card.knowledgeRequirement.red;
  const tempoBase = card.type === 'END_GAME' ? 7 : card.type === 'ONGOING' ? 9 : 5;
  const remainingRounds = state ? Math.max(1, 10 - state.roundNumber) : 5;
  const costPenalty = card.cost * 0.45;

  if (card.type === 'END_GAME' && card.endGameScoring) {
    const scoringPlayer = player ? withCardInPlay(player, card) : null;
    const projected = scoringPlayer ? safeEndGameScore(card, scoringPlayer) : staticEndGameCardValue(card.id);
    return tempoBase + projected + requirementFlex * 0.8 - costPenalty;
  }

  const playerValue = player ? politicsCardPlayerValue(card, player, state, remainingRounds) : staticPoliticsCardValue(card.id);
  return tempoBase + playerValue + requirementFlex * 0.6 - costPenalty;
}

function politicsCardPlayerValue(
  card: PoliticsCard,
  player: PlayerState,
  state: GameState | undefined,
  remainingRounds: number,
): number {
  switch (card.id) {
    case 'stoa-poikile': return Math.min(remainingRounds, 4) * 1.2;
    case 'amnesty-for-socrates': return Math.min(remainingRounds, 4) * 0.9;
    case 'persians': return Math.min(remainingRounds, 4) * 1.1;
    case 'extraordinary-collection': return Math.min(player.handCards.length, remainingRounds) * 1.2;
    case 'diolkos': return Math.min(remainingRounds, 4) * 1.7;
    case 'corinthian-columns': return Math.max(3, knowledgeColorDemand(player) * 1.4);
    case 'foreign-supplies': return Math.min(remainingRounds, 4) * 1.1;
    case 'gradualism': return Math.min(remainingRounds, 5) * 1.5;
    case 'old-guard': return hasProgressPlan(player) ? 3 : Math.min(remainingRounds, 4) * 3.2;
    case 'oracle': return Math.min(4 - player.developmentLevel, 3) * 3.5;
    case 'power': return state && state.players.some(p => p.playerId !== player.playerId && p.cultureTrack < player.cultureTrack) ? 4 : remainingRounds * 2.2;
    case 'public-market': return state && state.players.some(p => p.playerId !== player.playerId && p.economyTrack > player.economyTrack) ? 4 : remainingRounds * 1.8;
    case 'reformists': return Math.min(remainingRounds, 5) * 2.4;
    case 'founding-the-lyceum': return Math.min(remainingRounds, 5) * 1.1;
    case 'stadion': return remainingRounds * 0.9;
    case 'lighthouse': return Math.min(remainingRounds, 4) * 2.4;
    case 'helepole': return state ? Math.min(6, state.centralBoardTokens.filter(t => !t.explored && (t.skullValue ?? 0) > 0).length * 1.4) : 4;
    case 'constructing-the-mint': return Math.max(4, (7 - player.economyTrack) * 1.7);
    case 'ostracism': return 3 + player.playedCards.reduce((best, played) => Math.max(best, cardValue(played, player, state) * 0.25), 0);
    case 'rivalry': return state && state.players.filter(p => p.playerId !== player.playerId && p.isConnected).every(p => p.militaryTrack > player.militaryTrack)
      ? trackDeltaValue(player, 'MILITARY', 1)
      : 1;
    case 'peripteros': return trackDeltaValue(player, 'CULTURE', 1);
    case 'quarry': return taxGloryDeltaValue(player.taxTrack, 1);
    case 'contribution': return player.knowledgeTokens.filter(t => t.tokenType === 'MINOR').length * 0.7;
    case 'colossus-of-rhodes': return 10;
    case 'silver-mining': return taxGloryDeltaValue(player.taxTrack, 2);
    case 'scholarly-welcome': return 5 + Math.max(...rankedKnowledgeColors(player).map(color => knowledgeColorNeed(player, color)));
    case 'tunnel-of-eupalinos': return 6;
    case 'gifts-from-the-west': return 2.4;
    case 'council': return state
      ? state.politicsDeck.slice(0, 2).reduce((sum, deckCard) => sum + cardValue(deckCard, player) * 0.22, 6)
      : 9;
    case 'mercenary-recruitment': return player.economyTrack * 0.65;
    case 'archives': return 3.2;
    case 'greek-fire': return 2.8;
    default: return staticPoliticsCardValue(card.id);
  }
}

function staticPoliticsCardValue(cardId: string): number {
  const values: Record<string, number> = {
    'stoa-poikile': 9,
    'amnesty-for-socrates': 8,
    persians: 8,
    'extraordinary-collection': 10,
    diolkos: 10,
    'corinthian-columns': 12,
    'foreign-supplies': 8,
    gradualism: 12,
    'old-guard': 10,
    oracle: 11,
    power: 11,
    'public-market': 11,
    reformists: 14,
    'founding-the-lyceum': 8,
    stadion: 8,
    lighthouse: 10,
    helepole: 9,
    'constructing-the-mint': 13,
    ostracism: 8,
    rivalry: 5,
    peripteros: 8,
    quarry: 7,
    contribution: 5,
    'colossus-of-rhodes': 14,
    'silver-mining': 10,
    'scholarly-welcome': 12,
    'tunnel-of-eupalinos': 10,
    'gifts-from-the-west': 5,
    council: 12,
    'mercenary-recruitment': 7,
    archives: 8,
    'greek-fire': 8,
  };
  return values[cardId] ?? 6;
}

function staticEndGameCardValue(cardId: string): number {
  const values: Record<string, number> = {
    bank: 7,
    austerity: 9,
    proskenion: 8,
    diversification: 13,
    'central-government': 15,
    'gold-reserve': 13,
    'heavy-taxes': 10,
    'hall-of-statues': 12,
  };
  return values[cardId] ?? 8;
}

function safeEndGameScore(card: PoliticsCard, player: PlayerState): number {
  try {
    return card.endGameScoring?.calculate(player) ?? 0;
  } catch {
    return staticEndGameCardValue(card.id);
  }
}

function handCardPotential(card: PoliticsCard, player: PlayerState): number {
  const pairs = knowledgeShortfall(player, card.knowledgeRequirement);
  const playableNow = player.coins >= card.cost && pairs * 2 <= player.philosophyTokens;
  const playFriction = card.cost * 0.8 + pairs * 2.5 + (playableNow ? 0 : 8);
  return Math.max(0, cardValue(card, player) - playFriction);
}

function scrollDemand(player: PlayerState): number {
  const cardDemand = player.handCards.reduce((sum, card) => {
    const pairs = knowledgeShortfall(player, card.knowledgeRequirement);
    return sum + Math.max(0, pairs * 2 - player.philosophyTokens) / 2;
  }, 0);
  return Math.min(6, cardDemand + (player.philosophyTokens < 2 ? 2 - player.philosophyTokens : 0));
}

function tradeKnowledgeValue(player: PlayerState): number {
  const demand = knowledgeColorDemand(player);
  const canUseMinorSoon = player.coins + player.economyTrack + 1 >= (hasCard(player, 'corinthian-columns') ? 3 : 5);
  return canUseMinorSoon ? Math.min(8, 2 + demand * 0.35) : 0;
}

function bestExplorationValue(state: GameState, actor: PlayerState): number {
  const troopAfterGain = actor.troopTrack + actor.militaryTrack;
  return state.centralBoardTokens
    .filter(token => !token.explored && canExploreToken(actor, token, troopAfterGain))
    .reduce((best, token) => Math.max(best, tokenValue(token)), 0);
}

function actionTriggerValue(state: GameState, actor: PlayerState, action: ActionType): number {
  let value = 0;
  if (action === 'CULTURE') {
    if (hasCard(actor, 'stoa-poikile')) value += 1.6;
    if (hasCard(actor, 'persians')) value += 1.4;
    if (hasDevUnlocked(actor, 'olympia-dev-2')) value += 1.6;
  }
  if (action === 'TRADE') {
    if (hasCard(actor, 'diolkos')) value += 2.2;
    if (hasCard(actor, 'foreign-supplies')) value += 1.2;
    if (hasCard(actor, 'lighthouse')) value += 3;
    if (hasDevUnlocked(actor, 'miletus-dev-3')) value += 3;
  }
  if (action === 'POLITICS') {
    if (hasCard(actor, 'extraordinary-collection')) value += 1.8;
    if (hasDevUnlocked(actor, 'athens-dev-2')) value += 4;
    if (hasDevUnlocked(actor, 'athens-dev-3')) value += 1.1;
  }
  if (action === 'DEVELOPMENT') {
    if (hasCard(actor, 'oracle')) value += 4;
  }
  if (action === 'MILITARY') {
    if (hasDevUnlocked(actor, 'sparta-dev-2')) value += 1.2;
    value += bestExplorationValue(state, actor) * 0.15;
  }
  return value;
}

function withCardInPlay(player: PlayerState, card: PoliticsCard): PlayerState {
  if (player.playedCards.some(played => played.id === card.id)) return player;
  return {
    ...player,
    handCards: player.handCards.filter(handCard => handCard.id !== card.id),
    playedCards: [...player.playedCards, card],
  };
}

function trackDeltaValue(player: PlayerState, track: ProgressTrackType, amount: number): number {
  const after = advanceTrack(player, track, amount);
  return (after.victoryPoints - player.victoryPoints)
    + (after.coins - player.coins) * 0.25
    + (after.citizenTrack - player.citizenTrack) * 0.18
    + (after.taxTrack - player.taxTrack) * 1.2
    + (after.gloryTrack - player.gloryTrack) * 1.7
    + (after.economyTrack - player.economyTrack) * 1.4
    + (after.cultureTrack - player.cultureTrack) * 1.6
    + (after.militaryTrack - player.militaryTrack) * 1.25;
}

function taxGloryDeltaValue(current: number, amount: number): number {
  const cappedGain = Math.max(0, Math.min(10, current + amount) - current);
  return cappedGain * 1.2;
}

function knowledgeColorDemand(player: PlayerState): number {
  return (['GREEN', 'BLUE', 'RED'] as KnowledgeColor[])
    .reduce((sum, color) => sum + knowledgeColorNeed(player, color), 0);
}

function hasProgressPlan(player: PlayerState): boolean {
  return (['ECONOMY', 'CULTURE', 'MILITARY'] as ProgressTrackType[])
    .some(track => virtualAdvanceProgress(player, track) !== null);
}

function cardName(state: GameState, actor: PlayerState, cardId: string): string {
  return actor.playedCards.find(card => card.id === cardId)?.name
    ?? actor.handCards.find(card => card.id === cardId)?.name
    ?? state.politicsDeck.find(card => card.id === cardId)?.name
    ?? cardId;
}

function tokenValue(token: KnowledgeToken): number {
  return (token.tokenType === 'MAJOR' ? 9 : 4)
    + (token.bonusVP ?? 0)
    + (token.bonusCoins ?? 0) * 0.35
    + (token.isPersepolis ? 12 : 0)
    - (token.skullValue ?? 0) * 0.6;
}

function canExploreToken(actor: PlayerState, token: KnowledgeToken, troopAfterGain: number): boolean {
  const requirement = token.militaryRequirement ?? 0;
  return troopAfterGain >= requirement;
}

function knowledgeShortfall(player: PlayerState, requirement: KnowledgeRequirement): number {
  const counts = knowledgeCounts(player);
  return Math.max(0, requirement.green - counts.GREEN)
    + Math.max(0, requirement.blue - counts.BLUE)
    + Math.max(0, requirement.red - counts.RED);
}

function knowledgeCounts(player: PlayerState): Record<KnowledgeColor, number> {
  return {
    GREEN: player.knowledgeTokens.filter(t => t.color === 'GREEN').length,
    BLUE: player.knowledgeTokens.filter(t => t.color === 'BLUE').length,
    RED: player.knowledgeTokens.filter(t => t.color === 'RED').length,
  };
}

function rankedKnowledgeColors(player: PlayerState): KnowledgeColor[] {
  const counts = knowledgeCounts(player);
  return (['GREEN', 'BLUE', 'RED'] as KnowledgeColor[])
    .sort((a, b) => knowledgeColorNeed(player, b) - knowledgeColorNeed(player, a) || counts[a] - counts[b]);
}

function knowledgeColorNeed(player: PlayerState, color: KnowledgeColor): number {
  const field = color.toLowerCase() as 'green' | 'blue' | 'red';
  return player.handCards.reduce((sum, card) => sum + Math.max(0, card.knowledgeRequirement[field] - knowledgeCounts(player)[color]), 0);
}

function progressCost(player: PlayerState, track: ProgressTrackType): number {
  const current = player[trackField(track)];
  let cost = PROGRESS_COSTS[track][current] ?? 99;
  if (track === 'ECONOMY' && hasCard(player, 'constructing-the-mint')) cost = 0;
  if (cost > 0 && hasCard(player, 'gradualism')) cost = Math.max(0, cost - 1);
  if (cost > 0 && hasDevUnlocked(player, 'corinth-dev-3')) cost = Math.max(0, cost - 1);
  return cost;
}

function discountedProgressCost(player: PlayerState, track: ProgressTrackType, discount: number): number {
  return Math.max(0, progressCost(player, track) - discount);
}

function virtualAdvanceProgress(player: PlayerState, track: ProgressTrackType): PlayerState | null {
  if (player[trackField(track)] >= 7) return null;
  const cost = progressCost(player, track);
  if (player.coins < cost) return null;
  return advanceTrack({
    ...player,
    coins: player.coins - cost,
  }, track, 1);
}

function progressTrackPlans(
  player: PlayerState,
  maxAdvancements: number,
  spendScrolls: boolean,
): Array<{ tracks: ProgressTrackType[]; player: PlayerState; coinCost: number; value: number }> {
  const plans: Array<{ tracks: ProgressTrackType[]; player: PlayerState; coinCost: number; value: number }> = [{
    tracks: [],
    player,
    coinCost: 0,
    value: 0,
  }];

  const walk = (
    current: PlayerState,
    remaining: number,
    tracks: ProgressTrackType[],
    coinCost: number,
    value: number,
  ) => {
    if (remaining <= 0) return;

    for (const track of ['ECONOMY', 'CULTURE', 'MILITARY'] as ProgressTrackType[]) {
      if (current[trackField(track)] >= 7) continue;
      const cost = progressCost(current, track);
      const scrollCost = spendScrolls ? 1 : 0;
      if (current.coins < cost || current.philosophyTokens < scrollCost) continue;

      const after = advanceTrack({
        ...current,
        coins: current.coins - cost,
        philosophyTokens: current.philosophyTokens - scrollCost,
      }, track, 1);
      const nextTracks = [...tracks, track];
      const nextValue = value + progressValue(current, track);
      plans.push({
        tracks: nextTracks,
        player: after,
        coinCost: coinCost + cost,
        value: nextValue,
      });
      walk(after, remaining - 1, nextTracks, coinCost + cost, nextValue);
    }
  };

  walk(player, maxAdvancements, [], 0, 0);
  return plans;
}

function remainingProgressSteps(player: PlayerState): number {
  return (['ECONOMY', 'CULTURE', 'MILITARY'] as ProgressTrackType[])
    .reduce((sum, track) => sum + Math.max(0, 7 - player[trackField(track)]), 0);
}

function progressValue(player: PlayerState, track: ProgressTrackType): number {
  const next = player[trackField(track)] + 1;
  const milestone =
    track === 'ECONOMY' && (next === 4 || next === 7) ? (next === 4 ? 5 : 10) :
    track === 'CULTURE' && [3, 5, 6, 7].includes(next) ? 4 :
    track === 'MILITARY' && [2, 4, 6, 7].includes(next) ? 4 :
    0;
  return 4 + milestone - progressCost(player, track) * 0.5;
}

function eventProgressValue(player: PlayerState, track: ProgressTrackType, discount: number): number {
  const next = player[trackField(track)] + 1;
  const milestone =
    track === 'ECONOMY' && (next === 4 || next === 7) ? (next === 4 ? 5 : 10) :
    track === 'CULTURE' && [3, 5, 6, 7].includes(next) ? 4 :
    track === 'MILITARY' && [2, 4, 6, 7].includes(next) ? 4 :
    0;
  return 4 + milestone - discountedProgressCost(player, track, discount) * 0.5;
}

function hasCard(player: PlayerState, cardId: string): boolean {
  return player.playedCards.some(card => card.id === cardId);
}

function trackField(track: ProgressTrackType): 'economyTrack' | 'cultureTrack' | 'militaryTrack' {
  if (track === 'ECONOMY') return 'economyTrack';
  if (track === 'CULTURE') return 'cultureTrack';
  return 'militaryTrack';
}

function combinations<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, chosen: T[]) => {
    if (chosen.length === size) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      chosen.push(items[i]);
      walk(i + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return out;
}

function tokenLabel(token: KnowledgeToken): string {
  const special = token.isPersepolis ? ' Persepolis' : '';
  return `${formatColor(token.color)} ${token.tokenType.toLowerCase()}${special}`;
}

function formatColor(color: KnowledgeColor): string {
  return color.charAt(0) + color.slice(1).toLowerCase();
}

function formatTrack(track: ProgressTrackType): string {
  return track.charAt(0) + track.slice(1).toLowerCase();
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function errorResult(requestId: string, playerId: string, start: number, message: string): LiveSolverResult {
  return {
    requestId,
    playerId,
    generatedAt: Date.now(),
    status: 'ERROR',
    message,
    currentMove: null,
    rounds: [],
    projections: [],
    projectedMargin: null,
    searchedNodes: 0,
    completedLines: 0,
    computeMs: Date.now() - start,
    horizon: 'PARTIAL',
    proofStatus: 'UNPROVEN',
    proofNodes: 0,
    proofReason: message,
    opponentModel: 'LIGHTWEIGHT_ACHIEVEMENT_EVENT_FIELD',
  };
}

function provenExactResult(
  requestId: string,
  playerId: string,
  start: number,
  exact: ExactSearchResult,
): LiveSolverResult {
  const projection = projectScores(exact.node.state, playerId);
  const currentMove = exact.node.moves[0] ?? null;
  return {
    requestId,
    playerId,
    generatedAt: Date.now(),
    status: 'READY',
    message: 'Optimal line proven by exhaustive minimax search.',
    currentMove,
    rounds: groupMovesByRound(exact.node.moves),
    projections: projection.scores,
    projectedMargin: projection.margin,
    searchedNodes: exact.nodes,
    completedLines: 1,
    computeMs: Date.now() - start,
    horizon: 'FULL_GAME',
    proofStatus: 'PROVEN_OPTIMAL',
    proofNodes: exact.nodes,
    proofReason: exact.reason,
    opponentModel: 'LIGHTWEIGHT_ACHIEVEMENT_EVENT_FIELD',
  };
}

function unavailableResult(requestId: string, playerId: string, start: number, message: string): LiveSolverResult {
  return {
    ...errorResult(requestId, playerId, start, message),
    status: 'UNAVAILABLE',
  };
}

export const __liveSolverInternals = {
  enumerateCandidates,
  enumerateExactCandidates,
  orderSearchCandidates,
  opponentCandidateScore,
  achievementRaceOutlookScore,
  eventCompetitionOutlookScore,
  rankStrategyProfiles,
  strategyCandidateBonus,
  applyMessage,
  chooseBestActivation,
};
