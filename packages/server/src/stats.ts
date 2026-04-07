/**
 * Player stats persistence — JSON file on disk.
 *
 * Records every completed game's results per player, keyed by canonical name.
 * Stats file lives next to the server source at data/stats.json.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { FinalScoreBoard } from '@khora/shared';

// Store stats in a `data` folder at the project root
const STATS_DIR = join(process.cwd(), 'data');
const STATS_FILE = join(STATS_DIR, 'stats.json');

/** The four canonical player names. */
export const KNOWN_PLAYERS = ['Pete', 'Ian', 'LachG', 'LJC'] as const;
export type KnownPlayer = (typeof KNOWN_PLAYERS)[number];

/** A single game result recorded for a player. */
export interface GameRecord {
  date: string;           // ISO date string
  playerCount: number;    // how many players were in this game (2-4)
  rank: number;           // 1-based finishing position
  totalPoints: number;
  breakdown: {
    scoreTrackPoints: number;
    developmentPoints: number;
    politicsCardPoints: number;
    gloryKnowledgePoints: number;
  };
  city: string;           // city name or ID
}

/** Per-player stats blob. */
export interface PlayerStats {
  games: GameRecord[];
}

/** Full stats file shape. */
export interface StatsFile {
  players: Record<string, PlayerStats>;
}

function ensureStatsFile(): void {
  if (!existsSync(STATS_DIR)) {
    mkdirSync(STATS_DIR, { recursive: true });
  }
  if (!existsSync(STATS_FILE)) {
    const initial: StatsFile = { players: {} };
    for (const name of KNOWN_PLAYERS) {
      initial.players[name] = { games: [] };
    }
    writeFileSync(STATS_FILE, JSON.stringify(initial, null, 2), 'utf-8');
  }
}

export function loadStats(): StatsFile {
  ensureStatsFile();
  const raw = readFileSync(STATS_FILE, 'utf-8');
  const data: StatsFile = JSON.parse(raw);
  // Ensure all known players exist
  for (const name of KNOWN_PLAYERS) {
    if (!data.players[name]) {
      data.players[name] = { games: [] };
    }
  }
  return data;
}

function saveStats(data: StatsFile): void {
  ensureStatsFile();
  writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Record a completed game's results for all players.
 * Called once when a game reaches GAME_OVER.
 *
 * @param finalScores  The final scoreboard
 * @param playerCount  Number of players in this game
 * @param cityMap      Map of playerId → city name
 */
export function recordGame(
  finalScores: FinalScoreBoard,
  playerCount: number,
  cityMap: Record<string, string>,
): void {
  const stats = loadStats();
  const now = new Date().toISOString();

  for (const score of finalScores.rankings) {
    const name = score.playerName;
    // Only record for known players
    if (!stats.players[name]) continue;

    stats.players[name].games.push({
      date: now,
      playerCount,
      rank: score.rank,
      totalPoints: score.totalPoints,
      breakdown: {
        scoreTrackPoints: score.breakdown.scoreTrackPoints,
        developmentPoints: score.breakdown.developmentPoints,
        politicsCardPoints: score.breakdown.politicsCardPoints,
        gloryKnowledgePoints: score.breakdown.gloryKnowledgePoints,
      },
      city: cityMap[score.playerId] ?? 'Unknown',
    });
  }

  saveStats(stats);
  console.log(`[STATS] Recorded game with ${playerCount} players`);
}
