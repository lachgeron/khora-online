import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type {
  GameState,
  LiveSolverMove,
  LiveSolverReferenceLine,
  LiveSolverRequestOptions,
  LiveSolverResult,
  LiveSolverRoundPlan,
  LiveSolverSnapshot,
} from '@khora/shared';
import { runLiveSolver } from './live-solver';
import { gameStateFromLiveSolverSnapshot } from './live-solver-snapshot';
import { GameServer, makeDefaultCentralBoardTokens } from './integration';

interface CliOptions {
  snapshotPath: string | null;
  outPath: string;
  runtimeOutPath: string | null;
  player: string | null;
  generatedPlayers: string[];
  seed: number;
  iterations: number | null;
  iterationMs: number;
  exactMs: number;
  exactNodes: number;
  skipExactSearch: boolean;
  beamWidth: number;
  targetBranches: number;
  opponentBranches: number;
  completionWidth: number;
  maxDecisionPlies: number;
  keep: number;
  keepPerScenario: number;
  referenceLineWeight: number;
  referenceLineLimit: number;
  runtimeLineLimit: number;
  revisitEvery: number;
  targetScore: number | null;
  progressIntervalMs: number;
  runName: string;
}

interface SearchBook {
  version: 1;
  generatedAt: string;
  updatedAt: string;
  runName: string;
  totals: {
    iterations: number;
    searchedNodes: number;
    completedLines: number;
    computeMs: number;
  };
  records: ReferenceLineRecord[];
}

interface ReferenceLineRecord {
  id: string;
  scenarioKey: string;
  lineKey: string;
  source: 'snapshot' | 'generated';
  seed: number | null;
  iteration: number;
  playerId: string;
  playerName: string;
  cityId: string;
  score: number;
  projectedMargin: number | null;
  horizon: LiveSolverResult['horizon'];
  proofStatus: LiveSolverResult['proofStatus'];
  searchedNodes: number;
  completedLines: number;
  computeMs: number;
  tags: string[];
  scenario: ScenarioSummary;
  currentMove: LiveSolverMove | null;
  rounds: LiveSolverRoundPlan[];
  createdAt: string;
}

interface ScenarioSummary {
  roundNumber: number;
  currentPhase: GameState['currentPhase'];
  playerCount: number;
  players: Array<{
    playerId: string;
    playerName: string;
    cityId: string;
    handCardIds: string[];
    playedCardIds: string[];
  }>;
  currentEventId: string | null;
  eventDeckIds: string[];
  politicsDeckTopIds: string[];
  targetDiceByRound: Record<number, number[]>;
}

interface Scenario {
  state: GameState;
  source: 'snapshot' | 'generated';
  seed: number | null;
  key: string;
}

const INDIVIDUAL_SOLVER_CAP_MS = 600_000;
const DEFAULT_PLAYERS = ['LachG', 'LJC', 'Ian', 'Pete'];

async function main(): Promise<void> {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const options = parseArgs(process.argv.slice(2), workspaceRoot);

  if (options.iterationMs > INDIVIDUAL_SOLVER_CAP_MS) {
    console.log(
      `Each solver pass is capped at ${formatDuration(INDIVIDUAL_SOLVER_CAP_MS)}; ` +
      'the offline runner keeps looping until stopped.',
    );
  }

  let book = loadBook(options.outPath, options.runName);
  let stopRequested = false;

  process.once('SIGINT', () => {
    stopRequested = true;
    console.log('\nStop requested. Finishing the current solver pass and writing the book...');
  });

  const startedAt = Date.now();
  const startingIterations = book.totals.iterations;
  let sessionPass = 0;

  console.log(`Writing reference lines to ${options.outPath}`);
  console.log(options.snapshotPath
    ? `Using snapshot ${options.snapshotPath}`
    : `Generating seeded scenarios for ${options.generatedPlayers.join(', ')}`);
  console.log('Press Ctrl+C to stop after the current pass.');

  while (!stopRequested) {
    if (options.iterations !== null && sessionPass >= options.iterations) break;
    sessionPass += 1;
    const iteration = startingIterations + sessionPass;

    const scenario = options.snapshotPath
      ? loadSnapshotScenario(options.snapshotPath)
      : selectGeneratedScenario(options, book, iteration, sessionPass);
    const playerId = resolvePlayerId(scenario.state, options.player);
    const player = scenario.state.players.find(p => p.playerId === playerId);
    if (!player) throw new Error(`Unable to resolve player ${options.player ?? '(first player)'}.`);

    const referenceLines = selectReferenceLines(book, scenario, options);
    const solverOptions = optionsForIteration(options, iteration, referenceLines);
    const requestId = `offline-reference-${Date.now()}-${iteration}`;
    const passStartedAt = Date.now();
    let bestProgress: LiveSolverResult | null = null;
    let checkpointScore = bestScore(book);

    console.log(
      `[${new Date().toISOString()}] pass ${sessionPass} (${iteration} total) ` +
      `${scenario.source}${scenario.seed === null ? '' : ` seed=${scenario.seed}`} ` +
      `player=${player.playerName} budget=${formatDuration(solverOptions.timeBudgetMs ?? options.iterationMs)} ` +
      `reference-lines=${referenceLines.length}`,
    );

    const result = runLiveSolver(scenario.state, playerId, requestId, solverOptions, progress => {
      bestProgress = betterResult(bestProgress, progress, playerId);
      const score = projectedTotal(progress, playerId);
      if (Number.isFinite(score) && progress.horizon === 'FULL_GAME') {
        process.stdout.write(
          `\r  best=${score} margin=${progress.projectedMargin ?? 'n/a'} ` +
          `nodes=${progress.searchedNodes.toLocaleString()} lines=${progress.completedLines.toLocaleString()}   `,
        );

        if (score > checkpointScore) {
          const progressRecord = buildRecord(progress, scenario, playerId, iteration);
          book = mergeRecord(book, progressRecord, options);
          book.updatedAt = new Date().toISOString();
          writeBooks(options, book);
          checkpointScore = bestScore(book);
        }
      }
    });
    process.stdout.write('\n');

    const bestResult = betterResult(bestProgress, result, playerId) ?? result;
    const record = buildRecord(bestResult, scenario, playerId, iteration);
    const previousBest = bestScore(book);
    book = mergeRecord(book, record, options);
    book.totals.iterations += 1;
    book.totals.searchedNodes += result.searchedNodes;
    book.totals.completedLines += result.completedLines;
    book.totals.computeMs += Date.now() - passStartedAt;
    book.updatedAt = new Date().toISOString();
    writeBooks(options, book);

    const newBest = bestScore(book);
    const improved = newBest > previousBest ? ' improved' : '';
    console.log(
      `  saved score=${record.score} margin=${record.projectedMargin ?? 'n/a'} ` +
      `horizon=${record.horizon} nodes=${result.searchedNodes.toLocaleString()} ` +
      `lines=${result.completedLines.toLocaleString()}${improved}`,
    );

    if (options.targetScore !== null && newBest >= options.targetScore) {
      console.log(`Target score ${options.targetScore} reached.`);
      break;
    }
  }

  book.updatedAt = new Date().toISOString();
  writeBooks(options, book);

  const elapsed = Date.now() - startedAt;
  console.log(
    `Done. ${book.records.length} reference line(s), best score ${bestScore(book)}, ` +
    `elapsed ${formatDuration(elapsed)}.`,
  );
}

function parseArgs(args: string[], workspaceRoot: string): CliOptions {
  const defaultOut = join(workspaceRoot, 'tools', 'live-solver-reference-lines.json');
  const defaultRuntimeOut = join(workspaceRoot, 'packages', 'client', 'public', 'live-solver-reference-lines.json');
  const options: CliOptions = {
    snapshotPath: null,
    outPath: defaultOut,
    runtimeOutPath: defaultRuntimeOut,
    player: null,
    generatedPlayers: DEFAULT_PLAYERS,
    seed: 1,
    iterations: null,
    iterationMs: 10 * 60_000,
    exactMs: 0,
    exactNodes: 0,
    skipExactSearch: true,
    beamWidth: 1024,
    targetBranches: 160,
    opponentBranches: 1,
    completionWidth: 320,
    maxDecisionPlies: 6000,
    keep: 100,
    keepPerScenario: 5,
    referenceLineWeight: 18,
    referenceLineLimit: 80,
    runtimeLineLimit: 120,
    revisitEvery: 3,
    targetScore: null,
    progressIntervalMs: 5000,
    runName: 'offline-reference-search',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = () => {
      const value = args[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };

    switch (arg) {
      case '--help':
      case '-h':
        printHelp(defaultOut, defaultRuntimeOut);
        process.exit(0);
        break;
      case '--snapshot':
        options.snapshotPath = resolvePath(next(), workspaceRoot);
        break;
      case '--out':
        options.outPath = resolvePath(next(), workspaceRoot);
        break;
      case '--runtime-out':
        options.runtimeOutPath = resolvePath(next(), workspaceRoot);
        break;
      case '--no-runtime-out':
        options.runtimeOutPath = null;
        break;
      case '--player':
        options.player = next();
        break;
      case '--players':
        options.generatedPlayers = next().split(',').map(value => value.trim()).filter(Boolean);
        break;
      case '--seed':
        options.seed = parseInteger(next(), arg);
        break;
      case '--iterations':
        options.iterations = parseInteger(next(), arg);
        break;
      case '--iteration-ms':
      case '--budget':
        options.iterationMs = parseDuration(next(), arg);
        break;
      case '--exact-ms':
        options.exactMs = parseDuration(next(), arg);
        options.skipExactSearch = options.exactMs <= 0;
        break;
      case '--exact-nodes':
        options.exactNodes = parseInteger(next(), arg);
        break;
      case '--prove':
        options.skipExactSearch = false;
        options.exactMs = Math.max(options.exactMs, 60_000);
        options.exactNodes = Math.max(options.exactNodes, 5_000_000);
        break;
      case '--beam':
        options.beamWidth = parseInteger(next(), arg);
        break;
      case '--branches':
        options.targetBranches = parseInteger(next(), arg);
        break;
      case '--opponent-branches':
        options.opponentBranches = parseInteger(next(), arg);
        break;
      case '--completion':
        options.completionWidth = parseInteger(next(), arg);
        break;
      case '--plies':
        options.maxDecisionPlies = parseInteger(next(), arg);
        break;
      case '--keep':
        options.keep = parseInteger(next(), arg);
        break;
      case '--keep-per-scenario':
        options.keepPerScenario = parseInteger(next(), arg);
        break;
      case '--reference-weight':
        options.referenceLineWeight = parseInteger(next(), arg);
        break;
      case '--reference-limit':
        options.referenceLineLimit = parseInteger(next(), arg);
        break;
      case '--runtime-lines':
        options.runtimeLineLimit = parseInteger(next(), arg);
        break;
      case '--revisit-every':
        options.revisitEvery = parseInteger(next(), arg);
        break;
      case '--target-score':
        options.targetScore = parseInteger(next(), arg);
        break;
      case '--progress-ms':
        options.progressIntervalMs = parseDuration(next(), arg);
        break;
      case '--run-name':
        options.runName = next();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.generatedPlayers.length < 2) {
    throw new Error('--players must include at least two comma-separated names.');
  }

  return options;
}

function printHelp(defaultOut: string, defaultRuntimeOut: string): void {
  console.log(`Offline Khora reference-line search

Usage:
  npx tsx packages/server/src/offline-reference-search.ts [options]
  npm run reference:search -- -- [options]

Examples:
  npx tsx packages/server/src/offline-reference-search.ts --snapshot ./snapshot.json --player LachG --target-score 102
  npm run reference:search -- -- --iterations 1 --budget 30s --out ./tools/smoke-reference-lines.json
  npm run reference:search -- -- --players LachG,LJC,Ian,Pete --seed 42

Options:
  --snapshot <file>          LiveSolverSnapshot JSON. Without this, seeded scenarios are generated.
  --player <id-or-name>      Target player. Defaults to the first player in the scenario.
  --out <file>               Output reference book. Default: ${defaultOut}
  --runtime-out <file>       Runtime book for the browser solver. Default: ${defaultRuntimeOut}
  --no-runtime-out           Do not write the browser runtime book.
  --players <csv>            Generated scenario player names.
  --seed <number>            First generated scenario seed.
  --iterations <number>      Stop after N passes. Omit to run until Ctrl+C.
  --budget <duration>        Per-pass budget, e.g. 30s, 10m. Passes loop forever if iterations omitted.
  --target-score <number>    Stop once the saved book reaches this projected total.
  --prove                    Also spend exact-proof time after each principal search.
  --beam <number>            Base beam width.
  --branches <number>        Base target branch count.
  --completion <number>      Base completion rollout count.
  --keep <number>            Max records to keep globally.
  --keep-per-scenario <n>    Max records to keep for the same scenario.
  --reference-weight <n>     How strongly saved lines bias later passes. Default: 18.
  --reference-limit <n>      Max saved lines fed into each solver pass. Default: 80.
  --runtime-lines <n>        Max deduped lines written for the browser solver. Default: 120.
  --revisit-every <n>        In generated mode, revisit a strong prior seed every N passes. Default: 3.
`);
}

function optionsForIteration(
  options: CliOptions,
  iteration: number,
  referenceLines: LiveSolverReferenceLine[],
): LiveSolverRequestOptions {
  const variants = [
    { beam: 1, branches: 1, completion: 1, plies: 1 },
    { beam: 1.35, branches: 0.75, completion: 1.5, plies: 1 },
    { beam: 0.8, branches: 1.35, completion: 1.1, plies: 1 },
    { beam: 1.15, branches: 1.15, completion: 1.8, plies: 1.2 },
    { beam: 1.6, branches: 1, completion: 2, plies: 1.35 },
  ];
  const variant = variants[(iteration - 1) % variants.length];

  return {
    timeBudgetMs: Math.min(options.iterationMs, INDIVIDUAL_SOLVER_CAP_MS),
    beamWidth: Math.round(options.beamWidth * variant.beam),
    targetBranches: Math.round(options.targetBranches * variant.branches),
    opponentBranches: options.opponentBranches,
    completionWidth: Math.round(options.completionWidth * variant.completion),
    maxDecisionPlies: Math.round(options.maxDecisionPlies * variant.plies),
    exactTimeBudgetMs: options.skipExactSearch ? 0 : options.exactMs,
    exactNodeLimit: options.skipExactSearch ? 0 : options.exactNodes,
    progressIntervalMs: options.progressIntervalMs,
    skipExactSearch: options.skipExactSearch,
    referenceLines,
    referenceLineWeight: options.referenceLineWeight,
  };
}

function selectGeneratedScenario(
  options: CliOptions,
  book: SearchBook,
  iteration: number,
  sessionPass: number,
): Scenario {
  const revisitSeeds = promisingGeneratedSeeds(book);
  if (
    options.revisitEvery > 0
    && revisitSeeds.length > 0
    && sessionPass % options.revisitEvery === 0
  ) {
    const revisitIndex = Math.floor(sessionPass / options.revisitEvery - 1) % revisitSeeds.length;
    return createGeneratedScenario(revisitSeeds[revisitIndex], options.generatedPlayers);
  }

  return createGeneratedScenario(options.seed + iteration - 1, options.generatedPlayers);
}

function promisingGeneratedSeeds(book: SearchBook): number[] {
  const seen = new Set<number>();
  return book.records
    .filter(record => record.source === 'generated' && record.seed !== null)
    .sort((a, b) => b.score - a.score)
    .flatMap(record => {
      if (record.seed === null || seen.has(record.seed)) return [];
      seen.add(record.seed);
      return [record.seed];
    })
    .slice(0, 24);
}

function selectReferenceLines(
  book: SearchBook,
  scenario: Scenario,
  options: CliOptions,
): LiveSolverReferenceLine[] {
  if (options.referenceLineWeight <= 0 || options.referenceLineLimit <= 0) return [];

  const sameScenario = book.records
    .filter(record => record.scenarioKey === scenario.key)
    .sort(compareRecords);
  const global = book.records
    .filter(record => record.scenarioKey !== scenario.key)
    .sort(compareRecords);

  return [...sameScenario, ...global]
    .slice(0, options.referenceLineLimit)
    .map(record => ({
      score: record.score,
      projectedMargin: record.projectedMargin,
      scenarioKey: record.scenarioKey,
      cityId: record.cityId,
      tags: record.tags,
      moves: record.rounds.flatMap(round => round.moves.map(move => ({
        round: move.round,
        phase: move.phase,
        decisionType: move.decisionType,
        message: move.message,
      }))),
    }));
}

function compareRecords(a: ReferenceLineRecord, b: ReferenceLineRecord): number {
  return b.score - a.score;
}

function loadSnapshotScenario(snapshotPath: string): Scenario {
  const raw = JSON.parse(readFileSync(snapshotPath, 'utf8')) as unknown;
  const snapshot = findSnapshot(raw);
  if (!snapshot) {
    throw new Error(`No LiveSolverSnapshot found in ${snapshotPath}.`);
  }

  const state = gameStateFromLiveSolverSnapshot(snapshot);
  return {
    state,
    source: 'snapshot',
    seed: null,
    key: scenarioKey(state, 'snapshot', snapshotPath),
  };
}

function createGeneratedScenario(seed: number, players: string[]): Scenario {
  const state = withSeededRandom(seed, () => {
    const server = new GameServer();
    return server.createAndStartGame(players, {
      centralBoardTokens: makeDefaultCentralBoardTokens(),
    });
  });

  return {
    state,
    source: 'generated',
    seed,
    key: scenarioKey(state, 'generated', String(seed)),
  };
}

function findSnapshot(value: unknown): LiveSolverSnapshot | null {
  if (isLiveSolverSnapshot(value)) return value;
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return findSnapshot(record.liveSolverSnapshot)
    ?? findSnapshot(record.snapshot)
    ?? findSnapshot(record.privateState)
    ?? findSnapshot(record.private);
}

function isLiveSolverSnapshot(value: unknown): value is LiveSolverSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.players)
    && typeof record.currentPhase === 'string'
    && Array.isArray(record.eventDeckIds)
    && Array.isArray(record.politicsDeckIds)
    && typeof record.predeterminedDice === 'object';
}

function resolvePlayerId(state: GameState, requested: string | null): string {
  if (!requested) return state.players[0]?.playerId ?? '';
  const normalized = requested.trim().toLowerCase();
  const player = state.players.find(candidate =>
    candidate.playerId.toLowerCase() === normalized
    || candidate.playerName.toLowerCase() === normalized);
  if (!player) {
    throw new Error(`Player "${requested}" was not found. Available: ${state.players.map(p => `${p.playerName} (${p.playerId})`).join(', ')}`);
  }
  return player.playerId;
}

function buildRecord(
  result: LiveSolverResult,
  scenario: Scenario,
  playerId: string,
  iteration: number,
): ReferenceLineRecord {
  const player = scenario.state.players.find(candidate => candidate.playerId === playerId);
  if (!player) throw new Error(`Player ${playerId} not found while building record.`);

  const scenarioSummary = summarizeScenario(scenario.state, playerId);
  const lineKey = hashString(JSON.stringify(result.rounds.map(round => round.moves.map(move => move.message))));
  const score = projectedTotal(result, playerId);
  if (!Number.isFinite(score)) {
    throw new Error(`Solver did not return a projected total for ${player.playerName}: ${result.message}`);
  }

  return {
    id: `${scenario.key}-${lineKey}`,
    scenarioKey: scenario.key,
    lineKey,
    source: scenario.source,
    seed: scenario.seed,
    iteration,
    playerId,
    playerName: player.playerName,
    cityId: player.cityId,
    score,
    projectedMargin: result.projectedMargin,
    horizon: result.horizon,
    proofStatus: result.proofStatus,
    searchedNodes: result.searchedNodes,
    completedLines: result.completedLines,
    computeMs: result.computeMs,
    tags: inferTags(result),
    scenario: scenarioSummary,
    currentMove: result.currentMove,
    rounds: result.rounds,
    createdAt: new Date().toISOString(),
  };
}

function summarizeScenario(state: GameState, targetPlayerId: string): ScenarioSummary {
  return {
    roundNumber: state.roundNumber,
    currentPhase: state.currentPhase,
    playerCount: state.players.length,
    players: state.players.map(player => ({
      playerId: player.playerId,
      playerName: player.playerName,
      cityId: player.cityId,
      handCardIds: player.handCards.map(card => card.id),
      playedCardIds: player.playedCards.map(card => card.id),
    })),
    currentEventId: state.currentEvent?.id ?? null,
    eventDeckIds: state.eventDeck.map(event => event.id),
    politicsDeckTopIds: state.politicsDeck.slice(0, 12).map(card => card.id),
    targetDiceByRound: Object.fromEntries(
      Object.entries(state.predeterminedDice).map(([round, byPlayer]) => [
        Number(round),
        [...(byPlayer[targetPlayerId] ?? [])],
      ]),
    ),
  };
}

function scenarioKey(state: GameState, source: 'snapshot' | 'generated', salt: string): string {
  return hashString(JSON.stringify({
    source,
    salt,
    roundNumber: state.roundNumber,
    currentPhase: state.currentPhase,
    players: state.players.map(player => ({
      id: player.playerId,
      name: player.playerName,
      city: player.cityId,
      hand: player.handCards.map(card => card.id),
      played: player.playedCards.map(card => card.id),
    })),
    currentEvent: state.currentEvent?.id ?? null,
    eventDeck: state.eventDeck.map(event => event.id),
    politicsDeck: state.politicsDeck.map(card => card.id),
    dice: state.predeterminedDice,
  }));
}

function mergeRecord(book: SearchBook, record: ReferenceLineRecord, options: CliOptions): SearchBook {
  const records = [...book.records.filter(existing => existing.id !== record.id), record]
    .sort((a, b) => b.score - a.score);

  const perScenario = new Map<string, ReferenceLineRecord[]>();
  for (const candidate of records) {
    const bucket = perScenario.get(candidate.scenarioKey) ?? [];
    if (bucket.length < options.keepPerScenario) {
      bucket.push(candidate);
      perScenario.set(candidate.scenarioKey, bucket);
    }
  }

  return {
    ...book,
    records: Array.from(perScenario.values())
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, options.keep),
  };
}

function loadBook(outPath: string, runName: string): SearchBook {
  if (!existsSync(outPath)) {
    return emptyBook(runName);
  }

  const parsed = JSON.parse(readFileSync(outPath, 'utf8')) as Partial<SearchBook>;
  return {
    version: 1,
    generatedAt: parsed.generatedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    runName: parsed.runName ?? runName,
    totals: {
      iterations: parsed.totals?.iterations ?? 0,
      searchedNodes: parsed.totals?.searchedNodes ?? 0,
      completedLines: parsed.totals?.completedLines ?? 0,
      computeMs: parsed.totals?.computeMs ?? 0,
    },
    records: Array.isArray(parsed.records) ? parsed.records as ReferenceLineRecord[] : [],
  };
}

function emptyBook(runName: string): SearchBook {
  const now = new Date().toISOString();
  return {
    version: 1,
    generatedAt: now,
    updatedAt: now,
    runName,
    totals: {
      iterations: 0,
      searchedNodes: 0,
      completedLines: 0,
      computeMs: 0,
    },
    records: [],
  };
}

function writeBooks(options: CliOptions, book: SearchBook): void {
  writeBook(options.outPath, book);
  if (options.runtimeOutPath) {
    writeRuntimeBook(options.runtimeOutPath, book, options.runtimeLineLimit);
  }
}

function writeBook(outPath: string, book: SearchBook): void {
  mkdirSync(dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(stripRuntimeHelpers(book), null, 2)}\n`, 'utf8');
  renameSync(tempPath, outPath);
}

function writeRuntimeBook(outPath: string, book: SearchBook, limit: number): void {
  const runtimeBook = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceBook: {
      generatedAt: book.generatedAt,
      updatedAt: book.updatedAt,
      runName: book.runName,
      totals: book.totals,
      recordCount: book.records.length,
      bestScore: bestScore(book),
    },
    lines: runtimeReferenceLines(book, limit),
  };
  mkdirSync(dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(runtimeBook, null, 2)}\n`, 'utf8');
  renameSync(tempPath, outPath);
}

function runtimeReferenceLines(book: SearchBook, limit: number): LiveSolverReferenceLine[] {
  const seen = new Set<string>();
  return [...book.records]
    .sort(compareRecords)
    .flatMap(record => {
      const key = record.lineKey;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        score: record.score,
        projectedMargin: record.projectedMargin,
        scenarioKey: record.scenarioKey,
        cityId: record.cityId,
        tags: record.tags,
        moves: record.rounds.flatMap(round => round.moves.map(move => ({
          round: move.round,
          phase: move.phase,
          decisionType: move.decisionType,
          message: move.message,
        }))),
      }];
    })
    .slice(0, Math.max(0, limit));
}

function stripRuntimeHelpers(book: SearchBook): SearchBook {
  return {
    ...book,
    records: book.records.map(record => ({ ...record })),
  };
}

function betterResult(
  current: LiveSolverResult | null,
  candidate: LiveSolverResult | null,
  playerId: string,
): LiveSolverResult | null {
  if (!candidate) return current;
  if (!current) return candidate;
  const currentScore = projectedTotal(current, playerId);
  const candidateScore = projectedTotal(candidate, playerId);
  if (candidateScore !== currentScore) return candidateScore > currentScore ? candidate : current;
  if (candidate.horizon !== current.horizon) return candidate.horizon === 'FULL_GAME' ? candidate : current;
  return current;
}

function projectedTotal(result: LiveSolverResult, playerId: string): number {
  return result.projections.find(projection => projection.playerId === playerId)?.projectedTotal ?? Number.NEGATIVE_INFINITY;
}

function bestScore(book: SearchBook): number {
  return book.records.length > 0
    ? Math.max(...book.records.map(record => record.score))
    : Number.NEGATIVE_INFINITY;
}

function inferTags(result: LiveSolverResult): string[] {
  const tags = new Set<string>();
  for (const round of result.rounds) {
    for (const move of round.moves) {
      if (move.message?.type === 'RESOLVE_ACTION') {
        tags.add(move.message.actionType.toLowerCase());
        if (move.message.choices.targetCardId) tags.add(`card:${move.message.choices.targetCardId}`);
        if (move.message.choices.explorationTokenId) tags.add('token:explore');
        if (move.message.choices.buyMinorKnowledge) tags.add('token:minor-buy');
      } else if (move.message?.type === 'PROGRESS_TRACK') {
        tags.add('progress');
        tags.add(`progress:${move.message.advancement.track.toLowerCase()}`);
      } else if (move.message?.type === 'CLAIM_ACHIEVEMENT') {
        tags.add('achievement');
        tags.add(`achievement:${move.message.trackChoice.toLowerCase()}`);
      } else if (move.decisionType === 'ACTIVATE_DEV') {
        tags.add('development');
      }

      const text = `${move.instruction} ${move.detail}`.toLowerCase();
      for (const keyword of ['old guard', 'diversification', 'bank', 'gold reserve', 'heavy taxes', 'proskenion', 'colossus']) {
        if (text.includes(keyword)) tags.add(`strategy:${keyword.replaceAll(' ', '-')}`);
      }
    }
  }
  return Array.from(tags).sort();
}

function withSeededRandom<T>(seed: number, fn: () => T): T {
  const originalRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function resolvePath(value: string, workspaceRoot: string): string {
  return isAbsolute(value) ? value : resolve(workspaceRoot, value);
}

function parseInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer.`);
  return parsed;
}

function parseDuration(value: string, label: string): number {
  const match = value.match(/^(\d+)(ms|s|m|h)?$/i);
  if (!match) throw new Error(`${label} must be a duration like 5000, 30s, 10m, or 2h.`);
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase() ?? 'ms';
  switch (unit) {
    case 'ms': return amount;
    case 's': return amount * 1000;
    case 'm': return amount * 60_000;
    case 'h': return amount * 60 * 60_000;
    default: throw new Error(`${label} has unsupported duration unit ${unit}.`);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / (60 * 60_000)).toFixed(1)}h`;
}

function findWorkspaceRoot(start: string): string {
  let current = resolve(start);
  for (;;) {
    const packagePath = join(current, 'package.json');
    if (existsSync(packagePath)) {
      try {
        const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as { workspaces?: unknown };
        if (Array.isArray(packageJson.workspaces)) return current;
      } catch {
        // Keep walking upward.
      }
    }

    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
