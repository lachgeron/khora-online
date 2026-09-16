import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LiveSolverReferenceLine, LiveSolverSnapshot } from '@khora/shared';
import { gameStateFromLiveSolverSnapshot } from './live-solver-snapshot';
import { validateLiveSolverLine } from './live-solver';

interface CliOptions {
  snapshotPath: string | null;
  bookPath: string;
  player: string | null;
  limit: number;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (!options.snapshotPath) {
    throw new Error('Pass --snapshot <file> so validation can replay lines against a real game state.');
  }

  const snapshot = readJson<LiveSolverSnapshot>(options.snapshotPath);
  const state = gameStateFromLiveSolverSnapshot(snapshot);
  const playerId = resolvePlayerId(snapshot, options.player);
  const lines = loadReferenceLines(options.bookPath).slice(0, options.limit);
  if (lines.length === 0) throw new Error(`No reference lines found in ${options.bookPath}.`);

  let valid = 0;
  let invalid = 0;
  for (const [index, line] of lines.entries()) {
    const result = validateLiveSolverLine(state, playerId, line.moves);
    if (result.valid) {
      valid += 1;
      console.log(`[ok] #${index + 1} ${line.cityId ?? 'unknown'} score=${line.score} executed=${result.executedMoves}`);
    } else {
      invalid += 1;
      console.log(`[fail] #${index + 1} ${line.cityId ?? 'unknown'} score=${line.score} move=${(result.failedMoveIndex ?? -1) + 1}`);
      for (const error of result.errors) console.log(`       ${error}`);
    }
  }

  console.log(`Validated ${valid + invalid} line(s): ${valid} ok, ${invalid} failed.`);
  if (invalid > 0) process.exitCode = 1;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    snapshotPath: null,
    bookPath: resolve('packages/client/public/live-solver-reference-lines.json'),
    player: null,
    limit: 20,
  };

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const next = () => {
      const value = args[++index];
      if (!value) throw new Error(`Missing value for ${arg}.`);
      return value;
    };
    switch (arg) {
      case '--':
        break;
      case '--snapshot':
        options.snapshotPath = resolve(next());
        break;
      case '--book':
        options.bookPath = resolve(next());
        break;
      case '--player':
        options.player = next();
        break;
      case '--limit':
        options.limit = Math.max(1, Number.parseInt(next(), 10));
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (!arg.startsWith('-') && !options.snapshotPath) {
          options.snapshotPath = resolve(arg);
          break;
        }
        throw new Error(`Unknown option ${arg}.`);
    }
  }

  return options;
}

function loadReferenceLines(path: string): LiveSolverReferenceLine[] {
  const payload = readJson<{ lines?: LiveSolverReferenceLine[]; records?: Array<{ score: number; projectedMargin: number | null; scenarioKey?: string; cityId?: string; tags?: string[]; rounds?: Array<{ moves: LiveSolverReferenceLine['moves'] }> }> }>(path);
  if (Array.isArray(payload.lines)) return payload.lines;
  if (Array.isArray(payload.records)) {
    return payload.records.flatMap(record => record.rounds ? [{
      score: record.score,
      projectedMargin: record.projectedMargin,
      scenarioKey: record.scenarioKey,
      cityId: record.cityId,
      tags: record.tags,
      moves: record.rounds.flatMap(round => round.moves),
    }] : []);
  }
  return [];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function resolvePlayerId(snapshot: LiveSolverSnapshot, requested: string | null): string {
  if (!requested) return snapshot.players[0]?.playerId ?? '';
  const normalized = requested.toLowerCase();
  return snapshot.players.find(player =>
    player.playerId.toLowerCase() === normalized
    || player.playerName.toLowerCase() === normalized)?.playerId ?? requested;
}

function printHelp(): void {
  console.log(`Live solver reference-line validator

Usage:
  npm run reference:validate -- --snapshot ./snapshot.json --player LJC
  npm run reference:validate -- ./snapshot.json --player LJC
  npx tsx packages/server/src/live-solver-reference-validate.ts -- --snapshot ./snapshot.json

Options:
  --snapshot <file>  Live solver snapshot to replay from. Required unless passed as the first positional argument.
  --book <file>      Reference book/runtime JSON. Defaults to packages/client/public/live-solver-reference-lines.json.
  --player <name>    Player name or id. Defaults to first snapshot player.
  --limit <n>        Number of top lines to validate. Default: 20.
`);
}

main();
