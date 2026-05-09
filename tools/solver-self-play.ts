import type {
  ActionChoices,
  ActionType,
  CityCard,
  ClientMessage,
  DiceAssignment,
  DraftMode,
  GameState,
  KnowledgeColor,
  KnowledgeRequirement,
  KnowledgeToken,
  PlayerInfo,
  PlayerState,
  PoliticsCard,
  PrivatePlayerState,
  ProgressTrackType,
  PublicGameState,
  PublicPlayerState,
} from '@khora/shared';
import { ACTION_NUMBERS } from '@khora/shared';
import { GameEngine } from '../packages/server/src/game-engine';
import {
  makeDefaultAchievements,
  makeDefaultCentralBoardTokens,
  makeDefaultEventDeck,
  makeDefaultPoliticsDeck,
} from '../packages/server/src/integration';
import { getAllCityCards } from '../packages/server/src/game-data';
import { calculateFinalScores } from '../packages/server/src/scoring-engine';
import { getStateForPlayer } from '../packages/server/src/visibility';
import { runSolver } from '../packages/client/src/solver/solver';
import { buildSolverInput } from '../packages/client/src/solver/snapshot';
import type { Plan, RecommendedMove, SolverObjective } from '../packages/client/src/solver/types';

type OpponentKind = 'average' | 'greedy' | 'rival' | 'timeout';
type BotKind = Exclude<OpponentKind, 'timeout'>;
type DecisionSource = 'solver' | 'fallback' | 'setup' | 'event';

interface BenchmarkOptions {
  games: number;
  players: number;
  seed: number;
  solverMs: number;
  objective: SolverObjective;
  opponents: OpponentKind;
  draftMode: DraftMode;
  maxSteps: number;
  json: boolean;
  verbose: boolean;
  traceCheat: boolean;
  minWinRate: number | null;
}

interface PlannedDecision {
  message: ClientMessage;
  source: DecisionSource;
  label: string;
}

interface GameStats {
  decisions: number;
  cheatDecisions: number;
  illegalCommands: number;
  cheatIllegalCommands: number;
  timeouts: number;
  cheatTimeouts: number;
  solverCalls: number;
  solverMoves: number;
  solverFallbacks: number;
  solverNoPlan: number;
  solverIllegalCommands: number;
  solverMs: number;
  solverNodes: number;
  steps: number;
}

interface GameResult {
  gameIndex: number;
  seed: number;
  winnerId: string;
  won: boolean;
  cheatScore: number;
  bestOpponentScore: number;
  margin: number;
  rank: number;
  truncated: boolean;
  finalPlayers: FinalPlayerSummary[];
  stats: GameStats;
}

interface FinalPlayerSummary {
  playerId: string;
  playerName: string;
  cityId: string;
  totalPoints: number;
  rank: number;
  coins: number;
  victoryPoints: number;
  tracks: {
    economy: number;
    culture: number;
    military: number;
    tax: number;
    glory: number;
    troop: number;
    citizen: number;
  };
  knowledge: {
    minor: number;
    major: number;
  };
  handCards: string[];
  playedCards: string[];
}

const CHEAT_PLAYER_ID = 'p1';
const PROGRESS_COSTS: Record<ProgressTrackType, Record<number, number>> = {
  ECONOMY: { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 },
  CULTURE: { 1: 1, 2: 4, 3: 6, 4: 6, 5: 7, 6: 7 },
  MILITARY: { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9 },
};

const CARD_VALUES: Record<string, number> = {
  'central-government': 120,
  diversification: 112,
  'gold-reserve': 106,
  'public-market': 96,
  taxation: 94,
  philosophy: 90,
  'extraordinary-collection': 88,
  'corinthian-columns': 84,
  'constructing-the-mint': 82,
  gradualism: 80,
  'old-guard': 78,
  'scholarly-welcome': 76,
  council: 74,
  'greek-fire': 72,
  'colossus-of-rhodes': 72,
  'hall-of-statues': 70,
  bank: 68,
  socrates: 70,
  'amnesty-for-socrates': 66,
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const results: GameResult[] = [];

  for (let i = 0; i < options.games; i += 1) {
    const seed = options.seed + i * 9973;
    const result = await withSeed(seed, () => runOneGame(i + 1, seed, options));
    results.push(result);
    if (!options.json) {
      const verdict = result.won ? 'WIN' : 'LOSS';
      console.log(
        `Game ${result.gameIndex} seed ${seed}: ${verdict} `
        + `${result.cheatScore}-${result.bestOpponentScore} `
        + `margin ${signed(result.margin)} rank ${result.rank}`
        + ` | illegal ${result.stats.cheatIllegalCommands}, timeouts ${result.stats.cheatTimeouts}, solver ${result.stats.solverCalls}`,
      );
    }
  }

  const summary = summarize(results);
  if (options.json) {
    console.log(JSON.stringify({ options, summary, results }, null, 2));
  } else {
    printSummary(summary, options);
  }

  if (options.minWinRate !== null && summary.winRate < options.minWinRate) {
    process.exitCode = 1;
  }
}

async function runOneGame(gameIndex: number, seed: number, options: BenchmarkOptions): Promise<GameResult> {
  const engine = new GameEngine(options.draftMode);
  const players = makePlayers(options.players);
  let state = engine.initializeGame(
    players,
    getAllCityCards(),
    makeDefaultEventDeck(),
    makeDefaultPoliticsDeck(),
    makeDefaultAchievements(),
    makeDefaultCentralBoardTokens(),
    options.draftMode,
  );
  const stats = emptyStats();
  let truncated = false;

  while (state.currentPhase !== 'GAME_OVER') {
    stats.steps += 1;
    if (stats.steps > options.maxSteps) {
      truncated = true;
      break;
    }

    if (state.pendingDecisions.length === 0) {
      state = engine.advancePhase(state);
      continue;
    }

    const pendingSnapshot = [...state.pendingDecisions];
    for (const pending of pendingSnapshot) {
      const livePending = state.pendingDecisions.find(d =>
        d.playerId === pending.playerId && d.decisionType === pending.decisionType,
      );
      if (!livePending) continue;

      if (livePending.decisionType === 'PHASE_DISPLAY') {
        state = engine.handleTimeout(state, livePending.playerId);
        continue;
      }

      const isCheat = livePending.playerId === CHEAT_PLAYER_ID;
      stats.decisions += 1;
      if (isCheat) stats.cheatDecisions += 1;

      const planned = await chooseDecision(state, livePending.playerId, isCheat ? 'cheat' : options.opponents, options, stats);
      if (!planned) {
        if (options.traceCheat && isCheat) {
          console.log(`  cheat ${livePending.decisionType}: no command, timeout`);
        }
        stats.timeouts += 1;
        if (isCheat) stats.cheatTimeouts += 1;
        state = engine.handleTimeout(state, livePending.playerId);
        continue;
      }
      if (options.traceCheat && isCheat) {
        console.log(`  cheat ${livePending.decisionType}: ${planned.source} ${planned.label}`);
      }

      const result = planned.message.type === 'ADMIN_SWAP_CARD'
        ? applyAdminSwap(state, livePending.playerId, planned.message)
        : engine.handlePlayerDecision(state, livePending.playerId, planned.message);
      if (result.ok) {
        state = result.value;
        continue;
      }

      if (options.verbose) {
        console.warn(
          `Illegal ${planned.source} command in game ${gameIndex} seed ${seed}: `
          + `${livePending.playerId} ${livePending.decisionType} ${planned.label} -> ${result.error.message}`,
        );
      }
      stats.illegalCommands += 1;
      if (isCheat) stats.cheatIllegalCommands += 1;
      if (planned.source === 'solver') stats.solverIllegalCommands += 1;

      const fallback = planned.source === 'solver'
        ? await chooseDecision(state, livePending.playerId, isCheat ? 'cheat' : 'greedy', options, stats, true)
        : null;
      if (fallback) {
        const fallbackResult = fallback.message.type === 'ADMIN_SWAP_CARD'
          ? applyAdminSwap(state, livePending.playerId, fallback.message)
          : engine.handlePlayerDecision(state, livePending.playerId, fallback.message);
        if (fallbackResult.ok) {
          state = fallbackResult.value;
          continue;
        }
        if (options.verbose) {
          console.warn(
            `Illegal fallback after solver failure in game ${gameIndex} seed ${seed}: `
            + `${livePending.playerId} ${livePending.decisionType} ${fallback.label} -> ${fallbackResult.error.message}`,
          );
        }
        stats.illegalCommands += 1;
        if (isCheat) stats.cheatIllegalCommands += 1;
      }

      stats.timeouts += 1;
      if (isCheat) stats.cheatTimeouts += 1;
      state = engine.handleTimeout(state, livePending.playerId);
    }
  }

  const scores = state.finalScores ?? calculateFinalScores(state);
  const cheat = scores.rankings.find(s => s.playerId === CHEAT_PLAYER_ID);
  const bestOpponent = scores.rankings
    .filter(s => s.playerId !== CHEAT_PLAYER_ID)
    .sort((a, b) => b.totalPoints - a.totalPoints)[0];

  return {
    gameIndex,
    seed,
    winnerId: scores.winnerId,
    won: scores.winnerId === CHEAT_PLAYER_ID,
    cheatScore: cheat?.totalPoints ?? 0,
    bestOpponentScore: bestOpponent?.totalPoints ?? 0,
    margin: (cheat?.totalPoints ?? 0) - (bestOpponent?.totalPoints ?? 0),
    rank: cheat?.rank ?? 99,
    truncated,
    finalPlayers: summarizeFinalPlayers(state, scores),
    stats,
  };
}

function summarizeFinalPlayers(state: GameState, scores: ReturnType<typeof calculateFinalScores>): FinalPlayerSummary[] {
  return scores.rankings.map(score => {
    const player = state.players.find(p => p.playerId === score.playerId);
    return {
      playerId: score.playerId,
      playerName: score.playerName,
      cityId: player?.cityId ?? '',
      totalPoints: score.totalPoints,
      rank: score.rank,
      coins: player?.coins ?? 0,
      victoryPoints: player?.victoryPoints ?? 0,
      tracks: {
        economy: player?.economyTrack ?? 0,
        culture: player?.cultureTrack ?? 0,
        military: player?.militaryTrack ?? 0,
        tax: player?.taxTrack ?? 0,
        glory: player?.gloryTrack ?? 0,
        troop: player?.troopTrack ?? 0,
        citizen: player?.citizenTrack ?? 0,
      },
      knowledge: {
        minor: player?.knowledgeTokens.filter(token => token.tokenType === 'MINOR').length ?? 0,
        major: player?.knowledgeTokens.filter(token => token.tokenType === 'MAJOR').length ?? 0,
      },
      handCards: player?.handCards.map(card => card.id) ?? [],
      playedCards: player?.playedCards.map(card => card.id) ?? [],
    };
  });
}

async function chooseDecision(
  state: GameState,
  playerId: string,
  kind: OpponentKind | 'cheat',
  options: BenchmarkOptions,
  stats: GameStats,
  skipSolver = false,
): Promise<PlannedDecision | null> {
  if (kind === 'timeout') return null;
  const pending = state.pendingDecisions.find(d => d.playerId === playerId && d.decisionType !== 'PHASE_DISPLAY');
  if (!pending) return null;

  if (kind === 'cheat' && !skipSolver && canUseSolverForDecision(pending.decisionType)) {
    const solverDecision = await chooseSolverDecision(state, playerId, options, stats);
    if (solverDecision) return solverDecision;
    stats.solverFallbacks += 1;
  }

  if (kind === 'cheat') {
    return chooseCheatFallbackDecision(state, playerId);
  }

  const fallbackKind: BotKind = kind === 'average' ? 'average' : kind === 'rival' ? 'rival' : 'greedy';
  return chooseFallbackDecision(state, playerId, fallbackKind);
}

function canUseSolverForDecision(decisionType: string): boolean {
  return decisionType === 'ASSIGN_DICE'
    || decisionType === 'RESOLVE_ACTION'
    || decisionType === 'PROGRESS_TRACK'
    || decisionType === 'ACHIEVEMENT_TRACK_CHOICE';
}

async function chooseSolverDecision(
  state: GameState,
  playerId: string,
  options: BenchmarkOptions,
  stats: GameStats,
): Promise<PlannedDecision | null> {
  const view = getStateForPlayer(state, playerId);
  const input = buildSolverInput(view.public, view.private, playerId, options.objective);
  if (!input) return null;

  stats.solverCalls += 1;
  const start = Date.now();
  const deadline = start + options.solverMs;
  let progressPlan: Plan | null = null;

  try {
    const result = await runSolver(input, view.public, {
      shouldAbort: () => Date.now() >= deadline,
      onProgress: plan => { progressPlan = plan; },
      yieldToHost: () => Promise.resolve(),
    });
    const elapsed = Date.now() - start;
    stats.solverMs += elapsed;
    const plan = result.ok && 'plan' in result ? result.plan : progressPlan;
    if (plan) {
      stats.solverNodes += plan.exploredNodes;
      const command = commandFromPlan(plan, view.public, view.private, state, playerId);
      if (command) {
        stats.solverMoves += 1;
        return command;
      }
    }
  } catch (err) {
    stats.solverMs += Date.now() - start;
    if (!String(err).includes('Abort')) {
      // Keep benchmarks running; the illegal/timeout counters are more useful than crashing a batch.
    }
  }

  stats.solverNoPlan += 1;
  return null;
}

function commandFromPlan(
  plan: Plan,
  publicState: PublicGameState,
  privateState: PrivatePlayerState,
  state: GameState,
  playerId: string,
): PlannedDecision | null {
  const pending = state.pendingDecisions.find(d => d.playerId === playerId && d.decisionType !== 'PHASE_DISPLAY');
  if (!pending) return null;
  const moves = movesForPhase(plan, publicState.currentPhase);
  for (const move of moves) {
    const command = commandFromMove(move, pending, privateState, state, playerId, plan);
    if (command) return command;
  }
  return null;
}

function commandFromMove(
  move: RecommendedMove,
  pending: GameState['pendingDecisions'][number],
  privateState: PrivatePlayerState,
  state: GameState,
  playerId: string,
  plan: Plan,
): PlannedDecision | null {
  if (move.kind === 'ASSIGN_DICE') {
    if (pending.decisionType !== 'ASSIGN_DICE') return null;
    const assignedDice = move.assignments.map(a => a.dieValue).sort((a, b) => a - b);
    const liveDice = [...(privateState.diceRoll ?? [])].sort((a, b) => a - b);
    if (assignedDice.length !== liveDice.length || assignedDice.some((die, index) => die !== liveDice[index])) return null;
    if (!currentRoundPlanIsExecutable(plan, state, privateState, playerId)) return null;
    return {
      source: 'solver',
      label: 'solver dice',
      message: {
        type: 'ASSIGN_DICE',
        assignments: move.assignments.map((assignment, index) => ({
          slotIndex: index as 0 | 1 | 2,
          actionType: assignment.action as ActionType,
          dieValue: assignment.dieValue,
        })),
        philosophyTokensToSpend: move.philosophyTokensToSpend,
      },
    };
  }

  if (move.kind === 'RESOLVE_ACTION') {
    if (pending.decisionType !== 'RESOLVE_ACTION') return null;
    const player = state.players.find(p => p.playerId === playerId);
    if (!player || nextResolvableAction(player) !== move.actionType) return null;
    if (!solverActionChoicesAreLive(move.actionType as ActionType, move.choices, state, privateState, player)) return null;
    return {
      source: 'solver',
      label: `solver ${move.actionType}`,
      message: { type: 'RESOLVE_ACTION', actionType: move.actionType as ActionType, choices: move.choices },
    };
  }

  if (move.kind === 'PROGRESS_TRACK') {
    if (pending.decisionType !== 'PROGRESS_TRACK') return null;
    const player = state.players.find(p => p.playerId === playerId);
    if (!player || !solverProgressMoveIsLive(move, player)) return null;
    const [first, ...rest] = move.tracks;
    if (!first) return { source: 'solver', label: 'solver skip progress', message: { type: 'SKIP_PHASE' } };
    const extraCount = Math.max(0, Math.min(rest.length, move.philosophySpent));
    return {
      source: 'solver',
      label: `solver progress ${move.tracks.join(',')}`,
      message: {
        type: 'PROGRESS_TRACK',
        advancement: { track: first },
        extraTracks: rest.slice(0, extraCount).map(track => ({ track })),
        bonusTracks: rest.slice(extraCount).map(track => ({ track })),
      },
    };
  }

  if (move.kind === 'ACHIEVEMENT_TRACK_CHOICE') {
    if (pending.decisionType !== 'ACHIEVEMENT_TRACK_CHOICE') return null;
    return {
      source: 'solver',
      label: 'solver achievement',
      message: { type: 'CLAIM_ACHIEVEMENT', achievementId: pendingAchievementId(pending), trackChoice: move.choices[0] ?? 'TAX' },
    };
  }

  return null;
}

function solverActionChoicesAreLive(
  actionType: ActionType,
  choices: ActionChoices,
  state: GameState,
  privateState: PrivatePlayerState,
  player: PlayerState,
): boolean {
  if (actionType === 'POLITICS') {
    if (!choices.targetCardId) return false;
    const card = player.handCards.find(candidate => candidate.id === choices.targetCardId);
    if (!card) return false;
    if (player.coins < card.cost) return false;
    const philosophyPairs = choices.philosophyPairsToUse ?? 0;
    const shortfall = requirementShortfall(card.knowledgeRequirement, player.knowledgeTokens);
    if (philosophyPairs < shortfall || philosophyPairs * 2 > player.philosophyTokens) return false;
    if (card.id === 'scholarly-welcome' && !choices.scholarlyWelcomeColor) return false;
    if (card.id === 'ostracism') {
      if (!choices.ostracismReturnCardId) return false;
      if (!player.playedCards.some(played => played.id === choices.ostracismReturnCardId)) return false;
    }
    return choices.ostracismReturnCardId === undefined
      || player.playedCards.some(played => played.id === choices.ostracismReturnCardId);
  }
  if (actionType === 'LEGISLATION' && choices.targetCardId) {
    const legalDraw = privateState.legislationDraw?.length
      ? privateState.legislationDraw
      : state.politicsDeck.slice(0, 2);
    return legalDraw.some(card => card.id === choices.targetCardId);
  }
  if (actionType === 'MILITARY') {
    return [choices.explorationTokenId, choices.secondExplorationTokenId]
      .filter((id): id is string => Boolean(id))
      .every(id => {
        const token = state.centralBoardTokens.find(candidate => candidate.id === id);
        return token !== undefined && !token.explored && (token.militaryRequirement ?? 99) <= player.troopTrack + player.militaryTrack;
      });
  }
  if (actionType === 'TRADE' && choices.buyMinorKnowledge) {
    if (!choices.minorKnowledgeColor) return false;
    const tokenCost = hasCard(player, 'corinthian-columns') ? 3 : 5;
    return player.coins + player.economyTrack + 1 >= tokenCost;
  }
  if (actionType === 'DEVELOPMENT') {
    const city = getAllCityCards().find(c => c.id === player.cityId);
    const development = city?.developments[player.developmentLevel] ?? null;
    if (!development) return false;
    const philosophyPairs = choices.philosophyPairsToUse ?? 0;
    const shortfall = requirementShortfall(development.knowledgeRequirement, player.knowledgeTokens);
    return philosophyPairs >= shortfall
      && philosophyPairs * 2 <= player.philosophyTokens
      && development.drachmaCost <= player.coins;
  }
  return true;
}

function currentRoundPlanIsExecutable(
  plan: Plan,
  state: GameState,
  privateState: PrivatePlayerState,
  playerId: string,
): boolean {
  const player = state.players.find(p => p.playerId === playerId);
  if (!player) return false;
  const virtualHand = new Set(privateState.handCards.map(card => card.id));
  const legalDraw = privateState.legislationDraw?.length
    ? privateState.legislationDraw
    : state.politicsDeck.slice(0, 2);

  for (const move of plan.currentRound?.recommendedMoves ?? []) {
    if (move.kind !== 'RESOLVE_ACTION') continue;
    if (move.actionType === 'LEGISLATION' && move.choices.targetCardId) {
      if (!legalDraw.some(card => card.id === move.choices.targetCardId)) return false;
      virtualHand.add(move.choices.targetCardId);
      continue;
    }
    if (move.actionType === 'POLITICS') {
      if (!move.choices.targetCardId) return false;
      if (!virtualHand.has(move.choices.targetCardId)) return false;
      if (move.choices.ostracismReturnCardId !== undefined
        && !privateState.playedCards.some(card => card.id === move.choices.ostracismReturnCardId)) {
        return false;
      }
      virtualHand.delete(move.choices.targetCardId);
      if (move.choices.ostracismReturnCardId) virtualHand.add(move.choices.ostracismReturnCardId);
      continue;
    }
    if (move.actionType === 'MILITARY'
      && !solverActionChoicesAreLive(move.actionType as ActionType, move.choices, state, privateState, player)) {
      return false;
    }
  }
  return true;
}

function applyAdminSwap(
  state: GameState,
  playerId: string,
  message: Extract<ClientMessage, { type: 'ADMIN_SWAP_CARD' }>,
): { ok: true; value: GameState } | { ok: false; error: { message: string } } {
  if (message.handCardId === message.deckCardId) return { ok: false, error: { message: 'Cannot self-swap a card' } };
  const player = state.players.find(p => p.playerId === playerId);
  if (!player) return { ok: false, error: { message: 'Player not found' } };
  const handIndex = player.handCards.findIndex(card => card.id === message.handCardId);
  const deckIndex = state.politicsDeck.findIndex(card => card.id === message.deckCardId);
  if (handIndex < 0) return { ok: false, error: { message: 'Swap hand card not found' } };
  if (deckIndex < 0) return { ok: false, error: { message: 'Swap deck card not found' } };
  const target = state.politicsDeck[deckIndex];

  const nextHand = [...player.handCards];
  const nextDeck = [...state.politicsDeck];
  const oldHandCard = nextHand[handIndex];
  nextHand[handIndex] = target;
  nextDeck[deckIndex] = oldHandCard;

  return {
    ok: true,
    value: {
      ...state,
      politicsDeck: nextDeck,
      players: state.players.map(p => p.playerId === playerId ? { ...p, handCards: nextHand } : p),
      updatedAt: Date.now(),
    },
  };
}

function solverProgressMoveIsLive(move: Extract<RecommendedMove, { kind: 'PROGRESS_TRACK' }>, player: PlayerState): boolean {
  const [first, ...rest] = move.tracks;
  if (!first) return true;
  let coins = player.coins;
  let philosophyTokens = player.philosophyTokens;
  let economyTrack = player.economyTrack;
  let cultureTrack = player.cultureTrack;
  let militaryTrack = player.militaryTrack;
  const extraCount = Math.max(0, Math.min(rest.length, move.philosophySpent));
  const ordered = [
    { track: first, spendsPhilosophy: false },
    ...rest.slice(0, extraCount).map(track => ({ track, spendsPhilosophy: true })),
    ...rest.slice(extraCount).map(track => ({ track, spendsPhilosophy: false })),
  ];

  for (const step of ordered) {
    if (step.spendsPhilosophy) {
      if (philosophyTokens <= 0) return false;
      philosophyTokens -= 1;
    }
    const shadow = { ...player, coins, economyTrack, cultureTrack, militaryTrack };
    if (progressLevel(shadow, step.track) >= 7) return false;
    const cost = progressCost(shadow, step.track, 0);
    if (cost > coins) return false;
    coins -= cost;
    if (step.track === 'ECONOMY') economyTrack += 1;
    else if (step.track === 'CULTURE') cultureTrack += 1;
    else militaryTrack += 1;
  }
  return true;
}

function movesForPhase(plan: Plan, phase: PublicGameState['currentPhase']): RecommendedMove[] {
  const moves = plan.currentRound?.recommendedMoves ?? [];
  if (phase === 'DICE') return moves.filter(m => m.kind === 'ASSIGN_DICE');
  if (phase === 'ACTIONS') return moves.filter(m => m.kind === 'RESOLVE_ACTION');
  if (phase === 'PROGRESS') return moves.filter(m => m.kind === 'PROGRESS_TRACK');
  if (phase === 'ACHIEVEMENT') return moves.filter(m => m.kind === 'ACHIEVEMENT_TRACK_CHOICE');
  return [];
}

function chooseFallbackDecision(
  state: GameState,
  playerId: string,
  kind: BotKind,
): PlannedDecision | null {
  const pending = state.pendingDecisions.find(d => d.playerId === playerId && d.decisionType !== 'PHASE_DISPLAY');
  const player = state.players.find(p => p.playerId === playerId);
  if (!pending || !player) return null;

  switch (pending.decisionType) {
    case 'SELECT_CITY': {
      const offered = state.draftState?.cityDraft?.offeredCities[playerId] ?? [];
      const city = state.draftState?.cityDraft?.allCities
        .filter(c => offered.includes(c.id))
        .sort((a, b) => cityScore(b) - cityScore(a))[0];
      return city ? { source: 'setup', label: `city ${city.id}`, message: { type: 'SELECT_CITY', cityId: city.id } } : null;
    }
    case 'DRAFT_CARD': {
      const pack = state.draftState?.politicsDraft?.packs[playerId] ?? [];
      const card = pickDraftCard(pack, player, kind);
      return card ? { source: 'setup', label: `draft ${card.id}`, message: { type: 'DRAFT_CARD', cardId: card.id } } : null;
    }
    case 'PICK_BAN_CARD': {
      const draft = state.draftState?.pickBanDraft;
      if (!draft) return null;
      const unavailable = new Set([
        ...Object.values(draft.bannedCards).flatMap(cards => cards.map(c => c.id)),
        ...Object.values(draft.pickedCards).flatMap(cards => cards.map(c => c.id)),
      ]);
      const card = pickDraftCard(draft.allCards.filter(c => !unavailable.has(c.id)), player, kind);
      return card ? { source: 'setup', label: `${draft.phase} ${card.id}`, message: { type: 'PICK_BAN_CARD', cardId: card.id, action: draft.phase } } : null;
    }
    case 'ROLL_DICE':
      return { source: 'fallback', label: 'roll', message: { type: 'ROLL_DICE' } };
    case 'ASSIGN_DICE':
      return buildDiceAssignment(state, player, kind);
    case 'RESOLVE_ACTION': {
      const action = nextResolvableAction(player);
      const command = action ? buildActionCommand(state, player, action, kind) : null;
      return command ?? (action && actionCanBeSkipped(action)
        ? { source: 'fallback', label: `skip ${action}`, message: { type: 'SKIP_PHASE' } }
        : null);
    }
    case 'PROGRESS_TRACK':
      return buildProgressCommand(player, 0, 'fallback', kind);
    case 'ACHIEVEMENT_TRACK_CHOICE':
      return {
        source: 'fallback',
        label: 'achievement',
        message: {
          type: 'CLAIM_ACHIEVEMENT',
          achievementId: pendingAchievementId(pending),
          trackChoice: preferGlory(player) ? 'GLORY' : 'TAX',
        },
      };
    case 'ORACLE_CHOOSE_TOKEN': {
      const token = chooseOracleToken(player.knowledgeTokens);
      return token
        ? { source: 'event', label: 'oracle', message: { type: 'CHOOSE_TOKEN', tokenId: token.id } }
        : { source: 'event', label: 'oracle skip', message: { type: 'SKIP_PHASE' } };
    }
    case 'MILITARY_VICTORY_PROGRESS':
      return buildEventProgressCommand(player, ['ECONOMY', 'CULTURE', 'MILITARY'], 2);
    case 'RISE_OF_PERSIA_PROGRESS':
      return buildEventProgressCommand(player, ['MILITARY'], 2);
    case 'THIRTY_TYRANTS_DISCARD': {
      const discards = [...player.handCards]
        .sort((a, b) => cardScore(a, player) - cardScore(b, player))
        .slice(0, Math.min(2, player.handCards.length));
      return discards.length > 0
        ? { source: 'event', label: 'discard', message: { type: 'DISCARD_CARDS', cardIds: discards.map(c => c.id) } }
        : { source: 'event', label: 'discard skip', message: { type: 'SKIP_PHASE' } };
    }
    case 'PROSPERITY_POLITICS': {
      const politics = choosePoliticsCard(player, kind);
      return politics
        ? { source: 'event', label: `prosperity ${politics.card.id}`, message: { type: 'RESOLVE_ACTION', actionType: 'POLITICS', choices: politics.choices } }
        : { source: 'event', label: 'prosperity skip', message: { type: 'SKIP_PHASE' } };
    }
    case 'CONQUEST_ACTION': {
      const command = (['POLITICS', 'DEVELOPMENT', 'LEGISLATION', 'TRADE', 'CULTURE', 'PHILOSOPHY'] as ActionType[])
        .map(action => buildActionCommand(state, player, action, kind, 'event'))
        .filter((entry): entry is PlannedDecision & { score: number } => entry !== null && 'score' in entry)
        .sort((a, b) => b.score - a.score)[0];
      return command ?? { source: 'event', label: 'conquest skip', message: { type: 'SKIP_PHASE' } };
    }
    default:
      return null;
  }
}

function chooseCheatFallbackDecision(
  state: GameState,
  playerId: string,
): PlannedDecision | null {
  return chooseFallbackDecision(state, playerId, 'rival');
}

function buildDiceAssignment(state: GameState, player: PlayerState, kind: BotKind): PlannedDecision | null {
  const dice = player.diceRoll;
  if (!dice || dice.length === 0) return null;
  const candidates = (Object.keys(ACTION_NUMBERS) as ActionType[])
    .map(action => {
      const command = buildActionCommand(state, player, action, kind);
      return command && 'score' in command ? { action, score: command.score } : null;
    })
    .filter((entry): entry is { action: ActionType; score: number } => entry !== null);
  if (candidates.length < dice.length) return null;

  let best: { assignments: DiceAssignment[]; philosophyTokensToSpend: number; score: number } | null = null;
  for (const combo of combinations(candidates, dice.length)) {
    const mapping = bestDiceMapping(combo.map(c => c.action), dice);
    if (!mapping) continue;
    const shortfall = Math.max(0, mapping.citizenCost - player.citizenTrack);
    const philosophyTokensToSpend = kind === 'average' ? 0 : Math.ceil(shortfall / 3);
    if (mapping.citizenCost > player.citizenTrack + philosophyTokensToSpend * 3) continue;
    if (philosophyTokensToSpend > player.philosophyTokens) continue;
    const citizenPenalty = kind === 'average' ? 4 : kind === 'rival' ? 1.9 : 2.4;
    const score = combo.reduce((sum, c) => sum + c.score, 0) - mapping.citizenCost * citizenPenalty;
    if (!best || score > best.score) best = { assignments: mapping.assignments, philosophyTokensToSpend, score };
  }
  if (!best) return null;
  return {
    source: 'fallback',
    label: 'assign dice',
    message: {
      type: 'ASSIGN_DICE',
      assignments: best.assignments,
      philosophyTokensToSpend: best.philosophyTokensToSpend > 0 ? best.philosophyTokensToSpend : undefined,
    },
  };
}

function buildActionCommand(
  state: GameState,
  player: PlayerState,
  actionType: ActionType,
  kind: BotKind,
  source: DecisionSource = 'fallback',
): (PlannedDecision & { score: number }) | null {
  const rivalBonus = kind === 'rival' ? actionRaceBonus(state, player, actionType) : 0;
  switch (actionType) {
    case 'PHILOSOPHY':
      return actionCommand('PHILOSOPHY', {}, 5 + player.philosophyTokens * 0.1 + rivalBonus, source);
    case 'LEGISLATION': {
      const choices = legislationChoices(state, player);
      return actionCommand('LEGISLATION', choices, 10 + (choices.targetCardId ? 8 : 0) + rivalBonus, source);
    }
    case 'CULTURE':
      return actionCommand('CULTURE', {}, 8 + player.cultureTrack * 2 + (hasCard(player, 'stoa-poikile') ? 3 : 0) + rivalBonus, source);
    case 'TRADE': {
      const choices = tradeChoices(player);
      return actionCommand('TRADE', choices, 10 + player.economyTrack * 1.5 + (choices.buyMinorKnowledge ? 13 : 0) + rivalBonus, source);
    }
    case 'MILITARY': {
      const choices = militaryChoices(state, player);
      return actionCommand('MILITARY', choices, 10 + player.militaryTrack * 1.5 + (choices.explorationTokenId ? 16 : 0) + rivalBonus, source);
    }
    case 'POLITICS': {
      const card = choosePoliticsCard(player, kind);
      return card ? actionCommand('POLITICS', card.choices, 24 + card.score + rivalBonus, source) : null;
    }
    case 'DEVELOPMENT': {
      const plan = developmentChoices(state, player);
      return plan ? actionCommand('DEVELOPMENT', plan.choices, plan.score + rivalBonus, source) : null;
    }
    default:
      return null;
  }
}

function actionCommand(actionType: ActionType, choices: ActionChoices, score: number, source: DecisionSource): PlannedDecision & { score: number } {
  return {
    source,
    label: actionType,
    score,
    message: { type: 'RESOLVE_ACTION', actionType, choices },
  };
}

function buildProgressCommand(player: PlayerState, discount: number, source: DecisionSource, kind: BotKind = 'average'): PlannedDecision {
  const track = chooseProgressTrack(player, ['ECONOMY', 'CULTURE', 'MILITARY'], discount, kind);
  return track
    ? { source, label: `progress ${track}`, message: { type: 'PROGRESS_TRACK', advancement: { track } } }
    : { source, label: 'skip progress', message: { type: 'SKIP_PHASE' } };
}

function buildEventProgressCommand(player: PlayerState, tracks: ProgressTrackType[], discount: number): PlannedDecision {
  const track = chooseProgressTrack(player, tracks, discount, 'greedy');
  return track
    ? { source: 'event', label: `event progress ${track}`, message: { type: 'EVENT_PROGRESS_TRACK', track } }
    : { source: 'event', label: 'event progress skip', message: { type: 'SKIP_PHASE' } };
}

function chooseProgressTrack(player: PlayerState, tracks: ProgressTrackType[], discount: number, kind: BotKind): ProgressTrackType | null {
  return tracks
    .map(track => {
      const level = progressLevel(player, track);
      if (level >= 7) return null;
      const cost = progressCost(player, track, discount);
      if (cost > player.coins) return null;
      const costPenalty = kind === 'rival' ? 0.8 : 1.2;
      return { track, score: progressValue(player, track, kind) - cost * costPenalty };
    })
    .filter((entry): entry is { track: ProgressTrackType; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score)[0]?.track ?? null;
}

function choosePoliticsCard(player: PlayerState, kind: BotKind): { card: PoliticsCard; choices: ActionChoices; score: number } | null {
  const candidates = player.handCards
    .map(card => {
      const choices = politicsChoices(card, player);
      return choices ? { card, choices, score: cardScore(card, player) - card.cost } : null;
    })
    .filter((entry): entry is { card: PoliticsCard; choices: ActionChoices; score: number } => entry !== null)
    .sort((a, b) => kind === 'average'
      ? a.card.cost - b.card.cost || b.score - a.score
      : b.score - a.score || a.card.name.localeCompare(b.card.name));
  return candidates[0] ?? null;
}

function politicsChoices(card: PoliticsCard, player: PlayerState): ActionChoices | null {
  if (player.coins < card.cost) return null;
  const shortfall = requirementShortfall(card.knowledgeRequirement, player.knowledgeTokens);
  if (shortfall * 2 > player.philosophyTokens) return null;
  const choices: ActionChoices = { targetCardId: card.id };
  if (shortfall > 0) choices.philosophyPairsToUse = shortfall;
  if (card.id === 'scholarly-welcome') choices.scholarlyWelcomeColor = leastHeldColor(player.knowledgeTokens);
  if (card.id === 'ostracism') {
    const returnCard = player.playedCards
      .filter(c => c.id !== 'ostracism')
      .sort((a, b) => cardScore(b, player) - cardScore(a, player))[0];
    if (!returnCard) return null;
    choices.ostracismReturnCardId = returnCard.id;
  }
  return choices;
}

function legislationChoices(state: GameState, player: PlayerState): ActionChoices {
  const draw = state.politicsDeck.slice(0, Math.min(2, state.politicsDeck.length));
  const keep = [...draw].sort((a, b) => cardScore(b, player) - cardScore(a, player))[0];
  if (!keep) return {};
  return {
    targetCardId: keep.id,
    discardCardId: draw.find(card => card.id !== keep.id)?.id,
  };
}

function tradeChoices(player: PlayerState): ActionChoices {
  const tokenCost = hasCard(player, 'corinthian-columns') ? 3 : 5;
  const canBuy = player.coins + player.economyTrack + 1 >= tokenCost;
  return canBuy
    ? { buyMinorKnowledge: true, minorKnowledgeColor: leastHeldColor(player.knowledgeTokens) }
    : {};
}

function militaryChoices(state: GameState, player: PlayerState): ActionChoices {
  const choices: ActionChoices = {};
  const tokenIds = chooseExploreTokenIds(state, player, hasDev(player, 'thebes', 3) ? 2 : 1, player.troopTrack + player.militaryTrack, 0);
  if (tokenIds[0]) choices.explorationTokenId = tokenIds[0];
  if (tokenIds[1]) choices.secondExplorationTokenId = tokenIds[1];
  return choices;
}

function developmentChoices(state: GameState, player: PlayerState): { choices: ActionChoices; score: number } | null {
  const city = getAllCityCards().find(c => c.id === player.cityId);
  const development = city?.developments[player.developmentLevel];
  if (!development) return null;
  const shortfall = requirementShortfall(development.knowledgeRequirement, player.knowledgeTokens);
  if (player.coins < development.drachmaCost || shortfall * 2 > player.philosophyTokens) return null;

  const choices: ActionChoices = {};
  if (shortfall > 0) choices.philosophyPairsToUse = shortfall;
  let score = 24 + development.level * 4 + (development.effectType === 'END_GAME' ? 16 : development.effectType === 'ONGOING' ? 12 : 8) - development.drachmaCost;

  if (development.id === 'miletus-dev-2') {
    choices.devTrackChoices = (['ECONOMY', 'CULTURE', 'MILITARY'] as ProgressTrackType[])
      .filter(track => progressLevel(player, track) < 7)
      .sort((a, b) => progressValue(player, b) - progressValue(player, a))
      .slice(0, 2);
    score += choices.devTrackChoices.length * 6;
  }
  if (development.id === 'argos-dev-2') {
    choices.argosDevReward = player.citizenTrack <= 3 ? 'citizens' : player.coins <= 2 ? 'coins' : 'vp';
    score += choices.argosDevReward === 'vp' ? 8 : 5;
  }
  if (development.id === 'sparta-dev-3') {
    const tokenIds = chooseExploreTokenIds(state, player, 2, player.troopTrack + player.militaryTrack, player.militaryTrack);
    if (tokenIds.length > 0) choices.spartaMilitaryTokenIds = tokenIds;
    score += tokenIds.length * 12;
  }
  return { choices, score };
}

function chooseExploreTokenIds(
  state: GameState,
  player: PlayerState,
  maxCount: number,
  startingTroops: number,
  gainBetweenExplores: number,
): string[] {
  let troops = startingTroops;
  const chosen: string[] = [];
  for (let i = 0; i < maxCount; i += 1) {
    const token = state.centralBoardTokens
      .filter(t => !t.explored && !chosen.includes(t.id) && t.militaryRequirement !== undefined && t.militaryRequirement <= troops)
      .sort((a, b) => tokenScore(b, player) - tokenScore(a, player))[0];
    if (!token) break;
    chosen.push(token.id);
    troops = Math.max(0, troops - exploreLoss(token, player));
    if (i < maxCount - 1) troops += gainBetweenExplores;
  }
  return chosen;
}

function bestDiceMapping(actions: ActionType[], dice: number[]): { assignments: DiceAssignment[]; citizenCost: number } | null {
  let best: { assignments: DiceAssignment[]; citizenCost: number } | null = null;
  for (const diceOrder of permutations(dice)) {
    const assignments = actions.map((action, index) => ({
      slotIndex: index as 0 | 1 | 2,
      actionType: action,
      dieValue: diceOrder[index],
    }));
    const citizenCost = assignments.reduce((sum, a) => sum + Math.max(0, ACTION_NUMBERS[a.actionType] - a.dieValue), 0);
    if (!best || citizenCost < best.citizenCost) best = { assignments, citizenCost };
  }
  return best;
}

function nextResolvableAction(player: PlayerState): ActionType | null {
  return player.actionSlots
    .filter((slot): slot is NonNullable<typeof slot> => slot !== null && !slot.resolved)
    .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType])[0]?.actionType ?? null;
}

function actionCanBeSkipped(action: ActionType): boolean {
  return action === 'LEGISLATION' || action === 'POLITICS' || action === 'DEVELOPMENT';
}

function cityScore(city: CityCard): number {
  const tracks = city.startingTracks;
  return city.startingCoins * 1.5
    + tracks.economy * 7
    + tracks.culture * 8
    + tracks.military * 6
    + tracks.tax * 4
    + tracks.glory * 5
    + tracks.troop * 1.5
    + tracks.citizen * 2
    + city.developments.reduce((sum, dev) => sum + (dev.effectType === 'END_GAME' ? 9 : dev.effectType === 'ONGOING' ? 7 : 4), 0);
}

function pickDraftCard(cards: PoliticsCard[], player: PlayerState, kind: BotKind): PoliticsCard | null {
  if (cards.length === 0) return null;
  return [...cards].sort((a, b) => kind === 'average'
    ? a.cost - b.cost || cardScore(b, player) - cardScore(a, player)
    : cardScore(b, player) - cardScore(a, player))[0] ?? null;
}

function cardScore(card: PoliticsCard, player: PlayerState): number {
  const base = CARD_VALUES[card.id] ?? (card.type === 'END_GAME' ? 58 : card.type === 'ONGOING' ? 52 : 42);
  const demand = card.knowledgeRequirement.green + card.knowledgeRequirement.blue + card.knowledgeRequirement.red;
  const shortfall = requirementShortfall(card.knowledgeRequirement, player.knowledgeTokens);
  return base
    + dynamicCardValue(card, player)
    + demand * 4
    + card.cost * 0.8
    - Math.max(0, card.cost - player.coins) * 4
    - shortfall * 5;
}

function dynamicCardValue(card: PoliticsCard, player: PlayerState): number {
  switch (card.id) {
    case 'colossus-of-rhodes': return 24;
    case 'tunnel-of-eupalinos': return 16;
    case 'silver-mining': return Math.max(10, (10 - Math.min(9, player.taxTrack)) * 1.4);
    case 'quarry': return Math.max(5, (10 - Math.min(9, player.taxTrack)) * 0.7);
    case 'greek-fire': return 8 + player.militaryTrack;
    case 'scholarly-welcome': return 8 + missingColorCount(player);
    case 'reformists': return Math.max(8, 18 - player.economyTrack - player.cultureTrack - player.militaryTrack);
    case 'constructing-the-mint': return player.economyTrack < 7 ? 12 : 2;
    case 'lighthouse': return 10 + player.economyTrack;
    case 'central-government': return (player.playedCards.length + 1) * 4;
    case 'diversification': return 4 * Math.min(player.economyTrack, player.cultureTrack, player.militaryTrack);
    case 'gold-reserve': return player.economyTrack * 3;
    case 'heavy-taxes': return player.taxTrack * 3;
    case 'hall-of-statues': return player.knowledgeTokens.length * 3;
    case 'proskenion': return Math.min(18, player.citizenTrack * 2);
    case 'bank': return Math.floor(player.coins / 2) * 3;
    case 'austerity': return player.handCards.length * 3;
    default: return 0;
  }
}

function missingColorCount(player: PlayerState): number {
  const counts = tokenCounts(player.knowledgeTokens);
  return (counts.GREEN === 0 ? 1 : 0) + (counts.BLUE === 0 ? 1 : 0) + (counts.RED === 0 ? 1 : 0);
}

function actionRaceBonus(state: GameState, player: PlayerState, actionType: ActionType): number {
  switch (actionType) {
    case 'MILITARY': {
      const reach = player.troopTrack + player.militaryTrack;
      const bestToken = state.centralBoardTokens
        .filter(t => !t.explored && t.militaryRequirement !== undefined && t.militaryRequirement <= reach)
        .sort((a, b) => tokenScore(b, player) - tokenScore(a, player))[0];
      return bestToken ? Math.min(18, tokenScore(bestToken, player) * 0.35) : 0;
    }
    case 'DEVELOPMENT':
      return player.developmentLevel < 4 ? 5 + player.developmentLevel * 3 : 0;
    case 'CULTURE':
      return player.cultureTrack < 4 ? 14 : 2;
    case 'TRADE':
      return player.coins <= 3 ? 10 : 3;
    case 'POLITICS': {
      const card = choosePoliticsCard(player, 'greedy');
      return card ? Math.min(16, card.score * 0.12) : 0;
    }
    case 'LEGISLATION':
      return player.handCards.length <= 2 ? 10 : 2;
    default:
      return 0;
  }
}

function tokenScore(token: KnowledgeToken, player: PlayerState): number {
  const counts = tokenCounts(player.knowledgeTokens);
  const colorNeed = counts[token.color] === 0 ? 6 : token.tokenType === 'MAJOR' ? 3 : 0;
  const typeValue = token.isPersepolis ? 42 : token.tokenType === 'MAJOR' ? 18 : 8;
  return typeValue + colorNeed + (token.bonusVP ?? 0) * 1.4 + (token.bonusCoins ?? 0) * 0.9 - exploreLoss(token, player) * 0.7;
}

function exploreLoss(token: KnowledgeToken, player: PlayerState): number {
  const discount = (hasCard(player, 'helepole') ? 1 : 0) + (hasDev(player, 'sparta', 1) ? 1 : 0);
  return Math.max(0, (token.skullValue ?? 0) - discount);
}

function requirementShortfall(requirement: KnowledgeRequirement, tokens: KnowledgeToken[]): number {
  const counts = tokenCounts(tokens);
  return Math.max(0, requirement.green - counts.GREEN)
    + Math.max(0, requirement.blue - counts.BLUE)
    + Math.max(0, requirement.red - counts.RED);
}

function tokenCounts(tokens: KnowledgeToken[]): Record<KnowledgeColor, number> {
  return tokens.reduce<Record<KnowledgeColor, number>>((counts, token) => {
    counts[token.color] += 1;
    return counts;
  }, { GREEN: 0, BLUE: 0, RED: 0 });
}

function leastHeldColor(tokens: KnowledgeToken[]): KnowledgeColor {
  const counts = tokenCounts(tokens);
  return (['RED', 'BLUE', 'GREEN'] as KnowledgeColor[]).sort((a, b) => counts[a] - counts[b])[0] ?? 'BLUE';
}

function chooseOracleToken(tokens: KnowledgeToken[]): KnowledgeToken | null {
  const counts = tokenCounts(tokens);
  return [...tokens].sort((a, b) => {
    const valueA = (a.tokenType === 'MAJOR' ? 100 : 10) + (counts[a.color] > 1 ? -5 : 0);
    const valueB = (b.tokenType === 'MAJOR' ? 100 : 10) + (counts[b.color] > 1 ? -5 : 0);
    return valueA - valueB;
  })[0] ?? null;
}

function progressLevel(player: PlayerState | PublicPlayerState, track: ProgressTrackType): number {
  if (track === 'ECONOMY') return player.economyTrack;
  if (track === 'CULTURE') return player.cultureTrack;
  return player.militaryTrack;
}

function progressCost(player: PlayerState, track: ProgressTrackType, discount: number): number {
  let cost = PROGRESS_COSTS[track][progressLevel(player, track)] ?? 99;
  if (track === 'ECONOMY' && hasCard(player, 'constructing-the-mint')) cost = 0;
  if (cost > 0 && hasCard(player, 'gradualism')) cost = Math.max(0, cost - 1);
  if (cost > 0 && hasDev(player, 'corinth', 3)) cost = Math.max(0, cost - 1);
  return Math.max(0, cost - discount);
}

function progressValue(player: PlayerState | PublicPlayerState, track: ProgressTrackType, kind: BotKind = 'average'): number {
  const next = progressLevel(player, track) + 1;
  const rival = kind === 'rival';
  if (track === 'ECONOMY') {
    return 3 + next * 0.8 + (next === 4 ? 5 : next === 7 ? 10 : 0) + (rival && next >= 4 ? 4 : 0);
  }
  if (track === 'CULTURE') {
    return 3 + next + (next === 4 ? 12 : 0) + (next === 7 ? 8 : 0) + (rival && next === 4 ? 10 : 0);
  }
  return 3 + next * 1.2 + (next === 7 ? 8 : 0) + player.troopTrack * 0.2 + (rival && next >= 4 ? 4 : 0);
}

function hasCard(player: PlayerState, cardId: string): boolean {
  return player.playedCards.some(card => card.id === cardId);
}

function hasDev(player: PlayerState | PublicPlayerState, cityId: string, level: number): boolean {
  return player.cityId === cityId && player.developmentLevel >= level;
}

function preferGlory(player: PlayerState): boolean {
  return player.knowledgeTokens.some(t => t.tokenType === 'MAJOR') || player.taxTrack >= 8;
}

function pendingAchievementId(pending: { options?: unknown }): string {
  const options = pending.options;
  return options && typeof options === 'object' && 'achievementId' in options
    ? String((options as { achievementId?: unknown }).achievementId ?? '')
    : '';
}

function combinations<T>(items: T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (items.length < count) return [];
  const [first, ...rest] = items;
  return [
    ...combinations(rest, count - 1).map(combo => [first, ...combo]),
    ...combinations(rest, count),
  ];
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    return permutations(rest).map(permutation => [item, ...permutation]);
  });
}

function makePlayers(count: number): PlayerInfo[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `p${index + 1}`,
    playerName: index === 0 ? 'Cheat' : `Bot ${index}`,
  }));
}

function emptyStats(): GameStats {
  return {
    decisions: 0,
    cheatDecisions: 0,
    illegalCommands: 0,
    cheatIllegalCommands: 0,
    timeouts: 0,
    cheatTimeouts: 0,
    solverCalls: 0,
    solverMoves: 0,
    solverFallbacks: 0,
    solverNoPlan: 0,
    solverIllegalCommands: 0,
    solverMs: 0,
    solverNodes: 0,
    steps: 0,
  };
}

function summarize(results: GameResult[]) {
  const totals = results.reduce((acc, result) => {
    acc.wins += result.won ? 1 : 0;
    acc.margin += result.margin;
    acc.cheatScore += result.cheatScore;
    acc.bestOpponentScore += result.bestOpponentScore;
    acc.truncated += result.truncated ? 1 : 0;
    for (const key of Object.keys(result.stats) as Array<keyof GameStats>) {
      acc.stats[key] += result.stats[key];
    }
    return acc;
  }, {
    wins: 0,
    margin: 0,
    cheatScore: 0,
    bestOpponentScore: 0,
    truncated: 0,
    stats: emptyStats(),
  });
  const games = Math.max(1, results.length);
  return {
    games: results.length,
    wins: totals.wins,
    losses: results.length - totals.wins,
    winRate: totals.wins / games,
    avgMargin: totals.margin / games,
    avgCheatScore: totals.cheatScore / games,
    avgBestOpponentScore: totals.bestOpponentScore / games,
    truncatedGames: totals.truncated,
    stats: totals.stats,
  };
}

function printSummary(summary: ReturnType<typeof summarize>, options: BenchmarkOptions): void {
  const stats = summary.stats;
  console.log('');
  console.log('Solver self-play benchmark');
  console.log(`Games: ${summary.games} | Players: ${options.players} | Opponents: ${options.opponents} | Objective: ${options.objective}`);
  console.log(`Win rate: ${summary.wins}/${summary.games} (${percent(summary.winRate)})`);
  console.log(`Average score: ${summary.avgCheatScore.toFixed(1)} vs ${summary.avgBestOpponentScore.toFixed(1)} | Average margin: ${signed(summary.avgMargin)}`);
  console.log(`Cheat illegal commands: ${stats.cheatIllegalCommands}/${Math.max(1, stats.cheatDecisions)} (${percent(stats.cheatIllegalCommands / Math.max(1, stats.cheatDecisions))})`);
  console.log(`Cheat timeouts/fallback failures: ${stats.cheatTimeouts}/${Math.max(1, stats.cheatDecisions)} (${percent(stats.cheatTimeouts / Math.max(1, stats.cheatDecisions))})`);
  console.log(`Solver calls: ${stats.solverCalls} | Solver moves used: ${stats.solverMoves} | Fallbacks: ${stats.solverFallbacks} | Solver illegal: ${stats.solverIllegalCommands}`);
  console.log(`Average solver time: ${(stats.solverMs / Math.max(1, stats.solverCalls)).toFixed(1)}ms | Average nodes: ${Math.round(stats.solverNodes / Math.max(1, stats.solverCalls)).toLocaleString()}`);
  if (summary.truncatedGames > 0) {
    console.log(`Truncated games: ${summary.truncatedGames} (increase --max-steps if needed)`);
  }
}

function parseArgs(args: string[]): BenchmarkOptions {
  const positional = args.filter(arg => !arg.startsWith('--'));
  const get = (name: string, fallback: string): string => {
    const equalsArg = args.find(arg => arg.startsWith(`--${name}=`));
    if (equalsArg) return equalsArg.slice(name.length + 3);
    const index = args.indexOf(`--${name}`);
    if (index >= 0 && args[index + 1]) return args[index + 1];
    const envValue = process.env[`npm_config_${name.replaceAll('-', '_')}`];
    return envValue && envValue !== 'true' ? envValue : fallback;
  };
  const has = (name: string): boolean => {
    const envValue = process.env[`npm_config_${name.replaceAll('-', '_')}`];
    return args.includes(`--${name}`) || envValue === 'true' || envValue === 'false';
  };
  const games = positiveInt(get('games', positional[0] ?? '5'), 5);
  const players = Math.min(4, Math.max(2, positiveInt(get('players', positional[1] ?? '4'), 4)));
  const solverMs = Math.max(5, positiveInt(get('solver-ms', positional[2] ?? '150'), 150));
  const seed = positiveInt(get('seed', positional[3] ?? '20260509'), 20260509);
  const objective = get('objective', 'WIN_MARGIN') === 'MAX_VP' ? 'MAX_VP' : 'WIN_MARGIN';
  const opponentArg = get('opponents', 'average') as OpponentKind;
  const opponents: OpponentKind = opponentArg === 'greedy' || opponentArg === 'rival' || opponentArg === 'timeout'
    ? opponentArg
    : 'average';
  const draftMode = get('draft-mode', 'STANDARD') === 'PICK_BAN' ? 'PICK_BAN' : 'STANDARD';
  const minWinRateArg = get('min-win-rate', '');
  return {
    games,
    players,
    seed,
    solverMs,
    objective,
    opponents,
    draftMode,
    maxSteps: positiveInt(get('max-steps', positional[4] ?? '20000'), 20000),
    json: has('json'),
    verbose: has('verbose'),
    traceCheat: has('trace-cheat'),
    minWinRate: minWinRateArg === '' ? null : Number(minWinRateArg),
  };
}

function positiveInt(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function withSeed<T>(seed: number, fn: () => Promise<T>): Promise<T> {
  const originalRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return await fn();
  } finally {
    Math.random = originalRandom;
  }
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
