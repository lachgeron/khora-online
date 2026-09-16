import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type {
  GameState,
  LiveSolverReferenceLine,
  LiveSolverRequestOptions,
  LiveSolverResult,
  LiveSolverSnapshot,
  PlayerState,
} from '@khora/shared';
import { applyDevelopmentEffect } from './city-abilities';
import { ALL_CITIES } from './game-data';
import { GameServer, makeDefaultCentralBoardTokens } from './integration';
import { createLiveSolverSearchSession, runLiveSolver, validateLiveSolverLine } from './live-solver';
import { gameStateFromLiveSolverSnapshot } from './live-solver-snapshot';

interface CliOptions {
  bookPath: string;
  outPath: string | null;
  snapshotPath: string | null;
  player: string | null;
  players: string[];
  cities: string[];
  seeds: number[];
  budgets: number[];
  sliceMs: number | null;
  beamWidth: number;
  targetBranches: number;
  opponentBranches: number;
  completionWidth: number;
  maxDecisionPlies: number;
  referenceLineWeight: number;
  strict: boolean;
}

interface BenchmarkRow {
  suite: 'city-open' | 'snapshot';
  cityId: string;
  seed: number | null;
  budgetMs: number;
  score: number;
  target: number | null;
  gap: number | null;
  valid: boolean;
  horizon: LiveSolverResult['horizon'];
  completedLines: number;
  searchedNodes: number;
  elapsedMs: number;
  failedMoveIndex: number | null;
  validationErrors: string[];
  verifiedFinalScore: number | null;
  improvements: Array<{ elapsedMs: number; score: number }>;
  firstMoves: string[];
}

interface BenchmarkReport {
  version: 1;
  generatedAt: string;
  options: {
    bookPath: string;
    snapshotPath: string | null;
    cities: string[];
    seeds: number[];
    budgets: number[];
    sliceMs: number | null;
    referenceLineWeight: number;
  };
  sourceBook: {
    lineCount: number;
    bestScore: number | null;
    bestByCity: Record<string, number>;
  };
  rows: BenchmarkRow[];
  summary: {
    allValid: boolean;
    targetRowsMet: number;
    targetRows: number;
    bestByCity: Record<string, number>;
  };
}

const DEFAULT_PLAYERS = ['LachG', 'LJC', 'Ian', 'Pete'];
const DEFAULT_TARGETS: Record<string, number> = {
  athens: 90,
  corinth: 90,
  miletus: 95,
  sparta: 95,
  olympia: 100,
  argos: 90,
  thebes: 90,
};

function main(): void {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const options = parseArgs(process.argv.slice(2), workspaceRoot);
  const referenceLines = loadReferenceLines(options.bookPath);
  if (referenceLines.length === 0) {
    throw new Error(`No reference lines found in ${options.bookPath}.`);
  }

  const rows: BenchmarkRow[] = [];
  console.log(`Loaded ${referenceLines.length} reference line(s) from ${options.bookPath}`);

  if (options.snapshotPath) {
    const snapshot = readJson<LiveSolverSnapshot>(options.snapshotPath);
    const state = gameStateFromLiveSolverSnapshot(snapshot);
    const playerId = resolvePlayerId(state, options.player);
    for (const budgetMs of options.budgets) {
      rows.push(runScenario({
        suite: 'snapshot',
        state,
        playerId,
        seed: null,
        budgetMs,
        referenceLines,
        options,
      }));
    }
  } else {
    for (const seed of options.seeds) {
      for (const cityId of options.cities) {
        const { state, playerId } = buildCityOpenScenario(cityId, seed, options.players);
        for (const budgetMs of options.budgets) {
          rows.push(runScenario({
            suite: 'city-open',
            state,
            playerId,
            seed,
            budgetMs,
            referenceLines,
            options,
          }));
        }
      }
    }
  }

  const report = buildReport(options, referenceLines, rows);
  printRows(rows);
  printSummary(report);
  if (options.outPath) writeReport(options.outPath, report);

  if (options.strict && (!report.summary.allValid || report.summary.targetRowsMet < report.summary.targetRows)) {
    process.exitCode = 1;
  }
}

function runScenario({
  suite,
  state,
  playerId,
  seed,
  budgetMs,
  referenceLines,
  options,
}: {
  suite: BenchmarkRow['suite'];
  state: GameState;
  playerId: string;
  seed: number | null;
  budgetMs: number;
  referenceLines: LiveSolverReferenceLine[];
  options: CliOptions;
}): BenchmarkRow {
  const target = state.players.find(player => player.playerId === playerId);
  if (!target) throw new Error(`Player ${playerId} was not found.`);

  const solverOptions: LiveSolverRequestOptions = {
    timeBudgetMs: budgetMs,
    beamWidth: options.beamWidth,
    targetBranches: options.targetBranches,
    opponentBranches: options.opponentBranches,
    completionWidth: options.completionWidth,
    maxDecisionPlies: options.maxDecisionPlies,
    exactTimeBudgetMs: 0,
    exactNodeLimit: 0,
    skipExactSearch: true,
    progressIntervalMs: Math.max(1000, Math.min(10_000, Math.floor(budgetMs / 3))),
    referenceLines,
    referenceLineWeight: options.referenceLineWeight,
  };

  const startedAt = Date.now();
  let bestProgress: LiveSolverResult | null = null;
  const improvements: BenchmarkRow['improvements'] = [];
  const session = createLiveSolverSearchSession();
  let totalNodes = 0;
  let result: LiveSolverResult;
  do {
    result = runLiveSolver(state, playerId, `benchmark-${suite}-${target.cityId}-${seed ?? 'snapshot'}-${budgetMs}`, {
      ...solverOptions,
      timeBudgetMs: options.sliceMs === null ? budgetMs : Math.min(options.sliceMs, Math.max(1, budgetMs - (Date.now() - startedAt))),
    }, progress => {
      const previousScore = bestProgress ? projectedTotal(bestProgress, playerId) : -Infinity;
      bestProgress = betterResult(bestProgress, progress, playerId);
      if (bestProgress && projectedTotal(bestProgress, playerId) > previousScore) {
        improvements.push({ elapsedMs: Date.now() - startedAt, score: projectedTotal(bestProgress, playerId) });
      }
    }, session);
    totalNodes += result.searchedNodes;
    bestProgress = betterResult(bestProgress, result, playerId);
  } while (options.sliceMs !== null && Date.now() - startedAt < budgetMs);
  const best = bestProgress ?? result;
  const moves = best.rounds.flatMap(round => round.moves);
  const score = projectedTotal(best, playerId);
  const validation = validateLiveSolverLine(state, playerId, moves, score);
  const targetScore = DEFAULT_TARGETS[target.cityId] ?? null;

  return {
    suite,
    cityId: target.cityId,
    seed,
    budgetMs,
    score,
    target: targetScore,
    gap: targetScore === null ? null : score - targetScore,
    valid: validation.valid,
    horizon: best.horizon,
    completedLines: best.completedLines,
    searchedNodes: totalNodes,
    elapsedMs: Date.now() - startedAt,
    failedMoveIndex: validation.failedMoveIndex,
    validationErrors: validation.errors,
    verifiedFinalScore: validation.finalScore,
    improvements,
    firstMoves: moves.slice(0, 8).map(move => move.instruction),
  };
}

function buildCityOpenScenario(cityId: string, seed: number, players: string[]): { state: GameState; playerId: string } {
  const city = ALL_CITIES.find(candidate => candidate.id === cityId);
  if (!city) throw new Error(`Unknown city ${cityId}.`);

  const server = new GameServer();
  let state = withSeededRandom(seed, () =>
    server.createAndStartGame(players, { centralBoardTokens: makeDefaultCentralBoardTokens() }));
  const cityOrder = [cityId, ...ALL_CITIES.map(candidate => candidate.id).filter(id => id !== cityId)];
  state = {
    ...state,
    players: state.players.map((player, index) => applyCityStart(player, cityOrder[index % cityOrder.length])),
  };
  state = advanceDisplays(server, state);

  return {
    state,
    playerId: state.players[0]?.playerId ?? '',
  };
}

function applyCityStart(player: PlayerState, cityId: string): PlayerState {
  const city = ALL_CITIES.find(candidate => candidate.id === cityId);
  if (!city) throw new Error(`Unknown city ${cityId}.`);
  const reset: PlayerState = {
    ...player,
    cityId,
    coins: city.startingCoins,
    economyTrack: city.startingTracks.economy,
    cultureTrack: city.startingTracks.culture,
    militaryTrack: city.startingTracks.military,
    taxTrack: city.startingTracks.tax,
    gloryTrack: city.startingTracks.glory,
    troopTrack: city.startingTracks.troop,
    citizenTrack: city.startingTracks.citizen,
    victoryPoints: 0,
    philosophyTokens: 0,
    knowledgeTokens: [],
    playedCards: [],
    actionSlots: [null, null, null],
    diceRoll: null,
    diceRollHistory: [],
    developmentLevel: 1,
    hasFlagged: false,
  };
  return applyDevelopmentEffect(reset, city.developments[0]!);
}

function advanceDisplays(server: GameServer, state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (
    guard++ < 12
    && current.pendingDecisions.length === 1
    && current.pendingDecisions[0]?.decisionType === 'PHASE_DISPLAY'
  ) {
    current = server.engine.handleTimeout(current, '__display__');
  }
  return current;
}

function buildReport(
  options: CliOptions,
  referenceLines: LiveSolverReferenceLine[],
  rows: BenchmarkRow[],
): BenchmarkReport {
  const bestByCity: Record<string, number> = {};
  for (const row of rows) {
    bestByCity[row.cityId] = Math.max(bestByCity[row.cityId] ?? Number.NEGATIVE_INFINITY, row.score);
  }
  const targetRows = rows.filter(row => row.target !== null).length;
  const targetRowsMet = rows.filter(row => row.target !== null && row.score >= row.target).length;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    options: {
      bookPath: options.bookPath,
      snapshotPath: options.snapshotPath,
      cities: options.cities,
      seeds: options.seeds,
      budgets: options.budgets,
      sliceMs: options.sliceMs,
      referenceLineWeight: options.referenceLineWeight,
    },
    sourceBook: {
      lineCount: referenceLines.length,
      bestScore: referenceLines.length > 0 ? Math.max(...referenceLines.map(line => line.score)) : null,
      bestByCity: sourceBestByCity(referenceLines),
    },
    rows,
    summary: {
      allValid: rows.every(row => row.valid),
      targetRowsMet,
      targetRows,
      bestByCity,
    },
  };
}

function sourceBestByCity(lines: LiveSolverReferenceLine[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const line of lines) {
    if (!line.cityId) continue;
    result[line.cityId] = Math.max(result[line.cityId] ?? Number.NEGATIVE_INFINITY, line.score);
  }
  return result;
}

function printRows(rows: BenchmarkRow[]): void {
  console.log('\nBenchmark rows');
  console.log('city      seed budget score target gap valid horizon lines nodes first move');
  for (const row of rows) {
    const cells = [
      row.cityId.padEnd(9),
      String(row.seed ?? '-').padEnd(4),
      formatDuration(row.budgetMs).padEnd(6),
      String(row.score).padStart(5),
      String(row.target ?? '-').padStart(6),
      String(row.gap ?? '-').padStart(4),
      String(row.valid).padEnd(5),
      row.horizon.padEnd(9),
      String(row.completedLines).padStart(5),
      String(row.searchedNodes).padStart(7),
      row.firstMoves[0] ?? '-',
    ];
    console.log(cells.join(' '));
  }
}

function printSummary(report: BenchmarkReport): void {
  console.log('\nSummary');
  console.log(`valid=${report.summary.allValid}`);
  console.log(`targets=${report.summary.targetRowsMet}/${report.summary.targetRows}`);
  for (const [cityId, score] of Object.entries(report.summary.bestByCity).sort()) {
    const target = DEFAULT_TARGETS[cityId] ?? null;
    console.log(`${cityId}: best=${score}${target === null ? '' : ` target=${target} gap=${score - target}`}`);
  }
}

function writeReport(path: string, report: BenchmarkReport): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  renameSync(tempPath, path);
  console.log(`\nWrote benchmark report to ${path}`);
}

function parseArgs(args: string[], workspaceRoot: string): CliOptions {
  const defaults: CliOptions = {
    bookPath: join(workspaceRoot, 'packages', 'client', 'public', 'live-solver-reference-lines.json'),
    outPath: join(workspaceRoot, 'tools', 'live-solver-benchmark-report.json'),
    snapshotPath: null,
    player: null,
    players: DEFAULT_PLAYERS,
    cities: ALL_CITIES.map(city => city.id),
    seeds: [1],
    budgets: [10_000],
    sliceMs: null,
    beamWidth: 192,
    targetBranches: 48,
    opponentBranches: 1,
    completionWidth: 64,
    maxDecisionPlies: 1200,
    referenceLineWeight: 32,
    strict: false,
  };

  const options = { ...defaults };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (value === undefined) throw new Error(`Missing value for ${arg}.`);
      return value;
    };

    switch (arg) {
      case '--':
        break;
      case '--help':
      case '-h':
        printHelp(defaults);
        process.exit(0);
        break;
      case '--book':
        options.bookPath = resolvePath(next(), workspaceRoot);
        break;
      case '--out':
        options.outPath = resolvePath(next(), workspaceRoot);
        break;
      case '--no-out':
        options.outPath = null;
        break;
      case '--snapshot':
        options.snapshotPath = resolvePath(next(), workspaceRoot);
        break;
      case '--player':
        options.player = next();
        break;
      case '--players':
        options.players = splitList(next());
        break;
      case '--cities':
        options.cities = splitList(next());
        break;
      case '--seeds':
        options.seeds = parseIntegerList(next(), arg);
        break;
      case '--budget':
      case '--budgets':
        options.budgets = splitList(next()).map(value => parseDuration(value, arg));
        break;
      case '--budget-ms':
        options.budgets = [parseInteger(next(), arg)];
        break;
      case '--slice':
        options.sliceMs = parseDuration(next(), arg);
        if (options.sliceMs <= 0) throw new Error('--slice must be positive.');
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
      case '--reference-weight':
        options.referenceLineWeight = parseInteger(next(), arg);
        break;
      case '--strict':
        options.strict = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.players.length < 2) throw new Error('--players must include at least two comma-separated names.');
  if (options.cities.length === 0) throw new Error('--cities must include at least one city id.');
  if (options.budgets.length === 0) throw new Error('--budgets must include at least one duration.');
  if (options.snapshotPath && !existsSync(options.snapshotPath)) throw new Error(`Snapshot not found: ${options.snapshotPath}`);
  return options;
}

function printHelp(defaults: CliOptions): void {
  console.log(`Live solver benchmark

Usage:
  npm run solver:benchmark -- -- --budget 10s
  npx tsx packages/server/src/live-solver-benchmark.ts --cities olympia,sparta --budgets 5s,30s

Options:
  --book <file>          Runtime reference book. Default: ${defaults.bookPath}
  --out <file>           JSON report path. Default: ${defaults.outPath}
  --no-out               Print only; do not write a JSON report.
  --snapshot <file>      Benchmark a captured LiveSolverSnapshot instead of generated city openings.
  --player <id-or-name>  Snapshot target player. Defaults to first player.
  --players <csv>        Generated scenario player names.
  --cities <csv>         City ids to benchmark. Default: all cities.
  --seeds <csv>          Generated scenario seeds. Default: 1.
  --budgets <csv>        Durations such as 5s,30s,3m. Default: 10s.
  --slice <duration>     Resume a persistent search in short passes, as in the browser.
  --strict               Exit nonzero if any line is invalid or below target.
`);
}

function loadReferenceLines(path: string): LiveSolverReferenceLine[] {
  const payload = readJson<{
    lines?: LiveSolverReferenceLine[];
    records?: Array<{
      score: number;
      projectedMargin: number | null;
      scenarioKey?: string;
      cityId?: string;
      tags?: string[];
      rounds?: Array<{ moves: LiveSolverReferenceLine['moves'] }>;
    }>;
  }>(path);
  if (Array.isArray(payload.lines)) return payload.lines;
  if (Array.isArray(payload.records)) {
    return payload.records.flatMap(record => record.rounds
      ? [{
          score: record.score,
          projectedMargin: record.projectedMargin,
          scenarioKey: record.scenarioKey,
          cityId: record.cityId,
          tags: record.tags,
          moves: record.rounds.flatMap(round => round.moves),
        }]
      : []);
  }
  return [];
}

function betterResult(
  current: LiveSolverResult | null,
  candidate: LiveSolverResult | null,
  playerId: string,
): LiveSolverResult | null {
  if (!candidate || candidate.horizon !== 'FULL_GAME' || candidate.verifiedFinalScore === undefined) return current;
  if (!current) return candidate;
  const currentScore = projectedTotal(current, playerId);
  const candidateScore = projectedTotal(candidate, playerId);
  if (candidateScore !== currentScore) return candidateScore > currentScore ? candidate : current;
  if (candidate.horizon !== current.horizon) return candidate.horizon === 'FULL_GAME' ? candidate : current;
  return candidate.completedLines > current.completedLines ? candidate : current;
}

function projectedTotal(result: LiveSolverResult, playerId: string): number {
  return result.projections.find(projection => projection.playerId === playerId)?.projectedTotal ?? Number.NEGATIVE_INFINITY;
}

function resolvePlayerId(state: GameState, requested: string | null): string {
  if (!requested) return state.players[0]?.playerId ?? '';
  const normalized = requested.toLowerCase();
  return state.players.find(player =>
    player.playerId.toLowerCase() === normalized
    || player.playerName.toLowerCase() === normalized)?.playerId ?? requested;
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

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function resolvePath(value: string, workspaceRoot: string): string {
  return isAbsolute(value) ? value : resolve(workspaceRoot, value);
}

function parseIntegerList(value: string, label: string): number[] {
  const parsed = splitList(value).map(entry => parseInteger(entry, label));
  if (parsed.length === 0) throw new Error(`${label} must include at least one integer.`);
  return parsed;
}

function splitList(value: string): string[] {
  return value.split(/[,\s]+/).map(entry => entry.trim()).filter(Boolean);
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

main();
