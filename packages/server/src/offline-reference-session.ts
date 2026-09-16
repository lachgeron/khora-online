import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

interface SessionOptions {
  durationMs: number;
  passBudgetMs: number;
  heapMb: number;
  maxFailures: number;
  logDir: string;
  artifactDir: string;
  summaryPath: string | null;
  benchmarkAfter: boolean;
  benchmarkBudgets: string;
  searchArgs: string[];
}

interface PassRecord {
  pass: number;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  passBudgetMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  success: boolean;
  reducedNextBudget: boolean;
}

interface BookSummary {
  path: string;
  updatedAt: string | null;
  records: number;
  lines: number;
  bestScore: number | null;
  bestByCity: Record<string, number>;
}

interface SessionSummary {
  version: 1;
  stamp: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number;
  configuredPassBudgetMs: number;
  finalPassBudgetMs: number;
  heapMb: number;
  commandDefaults: string[];
  forwardedSearchArgs: string[];
  passes: PassRecord[];
  book: BookSummary | null;
  benchmark: {
    ran: boolean;
    exitCode: number | null;
    reportPath: string | null;
  };
}

const DEFAULT_DURATION_MS = 10 * 60 * 60_000;
const DEFAULT_PASS_BUDGET_MS = 2 * 60_000;
const DEFAULT_HEAP_MB = 8192;
const DEFAULT_MAX_FAILURES = 5;

async function main(): Promise<void> {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  const stamp = makeStamp();
  const options = parseArgs(process.argv.slice(2), workspaceRoot, stamp);
  mkdirSync(options.logDir, { recursive: true });
  mkdirSync(options.artifactDir, { recursive: true });

  const outLogPath = join(options.logDir, `reference-session-${stamp}.out.log`);
  const errLogPath = join(options.logDir, `reference-session-${stamp}.err.log`);
  const summaryPath = options.summaryPath ?? join(options.artifactDir, `reference-session-${stamp}.summary.json`);
  const outLog = new LogWriter(outLogPath);
  const errLog = new LogWriter(errLogPath);
  const startedAt = new Date();
  const deadline = startedAt.getTime() + options.durationMs;
  const commandDefaults = defaultSearchArgs(options.searchArgs);
  const summary: SessionSummary = {
    version: 1,
    stamp,
    startedAt: startedAt.toISOString(),
    endedAt: null,
    durationMs: options.durationMs,
    configuredPassBudgetMs: options.passBudgetMs,
    finalPassBudgetMs: options.passBudgetMs,
    heapMb: options.heapMb,
    commandDefaults,
    forwardedSearchArgs: options.searchArgs,
    passes: [],
    book: null,
    benchmark: {
      ran: false,
      exitCode: null,
      reportPath: null,
    },
  };

  console.log(`Reference session ${stamp}`);
  console.log(`Logs: ${outLogPath}`);
  console.log(`Errors: ${errLogPath}`);
  console.log(`Summary: ${summaryPath}`);
  console.log(`Duration: ${formatDuration(options.durationMs)}; pass budget: ${formatDuration(options.passBudgetMs)}; heap: ${options.heapMb} MB`);

  let pass = 0;
  let consecutiveFailures = 0;
  let activePassBudgetMs = options.passBudgetMs;

  while (Date.now() < deadline) {
    pass += 1;
    const remainingMs = deadline - Date.now();
    const passBudgetMs = Math.max(1_000, Math.min(activePassBudgetMs, remainingMs));
    const passStarted = new Date();
    const searchArgs = [
      ...commandDefaults,
      ...options.searchArgs,
      '--iterations',
      '1',
      '--budget',
      formatDurationArg(passBudgetMs),
    ];
    const npmArgs = ['run', 'reference:search', '--', ...searchArgs];
    const displayCommand = `npm ${npmArgs.join(' ')}`;

    writeLine(outLog, `\n[session] pass=${pass} started=${passStarted.toISOString()} budget=${formatDuration(passBudgetMs)}`);
    writeLine(outLog, `[session] command=${displayCommand}`);
    console.log(`\nPass ${pass}: ${formatDuration(passBudgetMs)} (${formatDuration(Math.max(0, remainingMs))} remaining)`);

    const result = await runChildProcess({
      cwd: workspaceRoot,
      args: npmArgs,
      heapMb: options.heapMb,
      outLog,
      errLog,
    });
    const passEnded = new Date();
    const success = result.exitCode === 0 && result.signal === null;
    let reducedNextBudget = false;

    if (success) {
      consecutiveFailures = 0;
      activePassBudgetMs = options.passBudgetMs;
    } else {
      consecutiveFailures += 1;
      activePassBudgetMs = Math.max(Math.min(30_000, options.passBudgetMs), Math.floor(activePassBudgetMs / 2));
      reducedNextBudget = true;
    }

    const record: PassRecord = {
      pass,
      startedAt: passStarted.toISOString(),
      endedAt: passEnded.toISOString(),
      durationMs: passEnded.getTime() - passStarted.getTime(),
      passBudgetMs,
      exitCode: result.exitCode,
      signal: result.signal,
      success,
      reducedNextBudget,
    };
    summary.passes.push(record);
    summary.finalPassBudgetMs = activePassBudgetMs;
    summary.book = summarizeBook(resolveSearchOutPath(workspaceRoot, options.searchArgs));
    writeJsonAtomic(summaryPath, summary);

    console.log(`Pass ${pass} ${success ? 'finished' : 'failed'} exit=${result.exitCode ?? result.signal}`);
    if (summary.book) {
      console.log(`Book best=${summary.book.bestScore ?? 'n/a'} records=${summary.book.records} lines=${summary.book.lines}`);
    }

    if (consecutiveFailures >= options.maxFailures) {
      writeLine(errLog, `[session] stopping after ${consecutiveFailures} consecutive failed passes`);
      break;
    }
  }

  if (options.benchmarkAfter) {
    const reportPath = join(options.artifactDir, `reference-session-${stamp}.benchmark.json`);
    console.log('\nRunning post-session benchmark...');
    const benchmark = await runChildProcess({
      cwd: workspaceRoot,
      args: ['run', 'solver:benchmark', '--', '--budgets', options.benchmarkBudgets, '--out', reportPath],
      heapMb: options.heapMb,
      outLog,
      errLog,
    });
    summary.benchmark = {
      ran: true,
      exitCode: benchmark.exitCode,
      reportPath,
    };
  }

  summary.endedAt = new Date().toISOString();
  summary.book = summarizeBook(resolveSearchOutPath(workspaceRoot, options.searchArgs));
  writeJsonAtomic(summaryPath, summary);
  outLog.close();
  errLog.close();

  console.log(`\nSession complete. Summary: ${summaryPath}`);
  if (summary.book) {
    console.log(`Final book best=${summary.book.bestScore ?? 'n/a'} records=${summary.book.records} lines=${summary.book.lines}`);
    for (const [cityId, score] of Object.entries(summary.book.bestByCity).sort()) {
      console.log(`${cityId}: ${score}`);
    }
  }
}

function parseArgs(args: string[], workspaceRoot: string, stamp: string): SessionOptions {
  const options: SessionOptions = {
    durationMs: DEFAULT_DURATION_MS,
    passBudgetMs: DEFAULT_PASS_BUDGET_MS,
    heapMb: DEFAULT_HEAP_MB,
    maxFailures: DEFAULT_MAX_FAILURES,
    logDir: join(workspaceRoot, '.codex-logs'),
    artifactDir: join(workspaceRoot, '.codex-artifacts'),
    summaryPath: null,
    benchmarkAfter: false,
    benchmarkBudgets: '5s,30s',
    searchArgs: [],
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (value === undefined) throw new Error(`Missing value for ${arg}.`);
      return value;
    };

    switch (arg) {
      case '--':
        options.searchArgs.push(...args.slice(index + 1));
        index = args.length;
        break;
      case '--help':
      case '-h':
        printHelp(workspaceRoot);
        process.exit(0);
        break;
      case '--duration':
        options.durationMs = parseDuration(next(), arg);
        break;
      case '--pass-budget':
      case '--budget-per-pass':
        options.passBudgetMs = parseDuration(next(), arg);
        break;
      case '--heap-mb':
        options.heapMb = parseInteger(next(), arg);
        break;
      case '--max-failures':
        options.maxFailures = parseInteger(next(), arg);
        break;
      case '--log-dir':
        options.logDir = resolvePath(next(), workspaceRoot);
        break;
      case '--artifact-dir':
        options.artifactDir = resolvePath(next(), workspaceRoot);
        break;
      case '--summary':
        options.summaryPath = resolvePath(next(), workspaceRoot);
        break;
      case '--benchmark-after':
        options.benchmarkAfter = true;
        break;
      case '--benchmark-budgets':
        options.benchmarkBudgets = next();
        break;
      default:
        options.searchArgs.push(arg);
        if (args[index + 1] && !args[index + 1]!.startsWith('-')) {
          options.searchArgs.push(args[++index]!);
        }
        break;
    }
  }

  if (!hasFlag(options.searchArgs, '--run-name')) {
    options.searchArgs.push('--run-name', `reference-session-${stamp}`);
  }
  return options;
}

function defaultSearchArgs(forwardedArgs: string[]): string[] {
  const defaults: Array<[string, string]> = [
    ['--keep', '700'],
    ['--keep-per-city', '80'],
    ['--runtime-lines', '420'],
    ['--reference-weight', '28'],
    ['--reference-limit', '180'],
  ];
  return defaults.flatMap(([flag, value]) => hasFlag(forwardedArgs, flag) ? [] : [flag, value]);
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function runChildProcess({
  cwd,
  args,
  heapMb,
  outLog,
  errLog,
}: {
  cwd: string;
  args: string[];
  heapMb: number;
  outLog: LogWriter;
  errLog: LogWriter;
}): Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const env = {
    ...process.env,
    NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, `--max-old-space-size=${heapMb}`),
  };

  return new Promise((resolvePromise, reject) => {
    const child = spawn(npm, args, {
      cwd,
      env,
      shell: process.platform === 'win32',
      windowsHide: true,
    });

    child.stdout.on('data', chunk => {
      process.stdout.write(chunk);
      outLog.write(chunk);
    });
    child.stderr.on('data', chunk => {
      process.stderr.write(chunk);
      errLog.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (exitCode, signal) => resolvePromise({ exitCode, signal }));
  });
}

function appendNodeOption(current: string | undefined, option: string): string {
  if (!current || current.trim().length === 0) return option;
  if (current.includes(option)) return current;
  return `${current} ${option}`;
}

function resolveSearchOutPath(workspaceRoot: string, searchArgs: string[]): string {
  const explicit = valueAfter(searchArgs, '--out');
  return explicit ? resolvePath(explicit, workspaceRoot) : join(workspaceRoot, 'tools', 'live-solver-reference-lines.json');
}

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

function summarizeBook(path: string): BookSummary | null {
  if (!existsSync(path)) return null;
  const payload = JSON.parse(readFileSync(path, 'utf8')) as {
    generatedAt?: string;
    updatedAt?: string;
    records?: Array<{ score?: number; cityId?: string }>;
    lines?: Array<{ score?: number; cityId?: string }>;
  };
  const rows = payload.records?.length ? payload.records : payload.lines ?? [];
  const bestByCity: Record<string, number> = {};
  for (const row of rows) {
    if (typeof row.score !== 'number') continue;
    const cityId = row.cityId ?? 'unknown';
    bestByCity[cityId] = Math.max(bestByCity[cityId] ?? Number.NEGATIVE_INFINITY, row.score);
  }

  return {
    path,
    updatedAt: payload.updatedAt ?? payload.generatedAt ?? null,
    records: payload.records?.length ?? 0,
    lines: payload.lines?.length ?? 0,
    bestScore: rows.length > 0
      ? Math.max(...rows.map(row => typeof row.score === 'number' ? row.score : Number.NEGATIVE_INFINITY))
      : null,
    bestByCity,
  };
}

class LogWriter {
  private readonly path: string;
  private buffer = '';

  constructor(path: string) {
    this.path = path;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '', 'utf8');
  }

  write(chunk: unknown): void {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    if (this.buffer.length > 32_000) this.flush();
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    writeFileSync(this.path, this.buffer, { encoding: 'utf8', flag: 'a' });
    this.buffer = '';
  }

  close(): void {
    this.flush();
  }
}

function writeLine(writer: LogWriter, line: string): void {
  writer.write(`${line}\n`);
  writer.flush();
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tempPath, path);
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

function formatDurationArg(ms: number): string {
  if (ms % (60 * 60_000) === 0) return `${ms / (60 * 60_000)}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

function makeStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
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

function printHelp(workspaceRoot: string): void {
  console.log(`Crash-resilient Khora reference session

Usage:
  npm run reference:session -- -- --duration 10h --pass-budget 2m
  npm run reference:session -- -- --duration 1h --pass-budget 90s --out ./tools/book.json

Runner options:
  --duration <duration>          Total session length. Default: ${formatDuration(DEFAULT_DURATION_MS)}.
  --pass-budget <duration>       Budget for each isolated search process. Default: ${formatDuration(DEFAULT_PASS_BUDGET_MS)}.
  --heap-mb <n>                  NODE_OPTIONS heap size for each pass. Default: ${DEFAULT_HEAP_MB}.
  --max-failures <n>             Stop after this many consecutive child failures. Default: ${DEFAULT_MAX_FAILURES}.
  --benchmark-after              Run solver:benchmark when the session ends.
  --benchmark-budgets <csv>      Benchmark budgets if --benchmark-after is set. Default: 5s,30s.
  --summary <file>               Session summary JSON path.

Any other arguments are forwarded to reference:search. Defaults are added unless overridden:
  --keep 700 --keep-per-city 80 --runtime-lines 420 --reference-weight 28 --reference-limit 180

Default workspace:
  ${workspaceRoot}
`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
