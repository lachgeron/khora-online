/**
 * Game log system for Khora Online.
 *
 * Appends timestamped entries to the game log and retrieves them
 * in chronological order.
 */

import type { GameState, PlayerState } from '@khora/shared';
import type { GameLogEntry, GamePhase } from '@khora/shared';

/**
 * Append a log entry to the game state's log.
 * Automatically adds a timestamp to the entry.
 * Returns a new GameState with the entry appended.
 */
export function appendLogEntry(
  state: GameState,
  entry: Omit<GameLogEntry, 'timestamp'>,
): GameState {
  const fullEntry: GameLogEntry = {
    ...entry,
    timestamp: Date.now(),
  };
  return {
    ...state,
    gameLog: [...state.gameLog, fullEntry],
  };
}

/**
 * Get the game log in chronological order (sorted by timestamp ascending).
 */
export function getLog(state: GameState): GameLogEntry[] {
  return [...state.gameLog].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Compare a player's state before and after an operation and log all changes.
 * Tracks: coins, VP, philosophy tokens, economy/culture/military/tax/glory/troop/citizen tracks,
 * knowledge tokens, hand cards, played cards, development level.
 */
export function logPlayerDiff(
  state: GameState,
  before: PlayerState,
  after: PlayerState,
  context: { roundNumber: number; phase: GamePhase; source: string },
): GameState {
  let s = state;
  const pid = before.playerId;
  const { roundNumber, phase, source } = context;

  const diffs: string[] = [];

  if (after.coins !== before.coins) {
    const d = after.coins - before.coins;
    diffs.push(`${d > 0 ? '+' : ''}${d} drachma`);
  }
  if (after.victoryPoints !== before.victoryPoints) {
    const d = after.victoryPoints - before.victoryPoints;
    diffs.push(`${d > 0 ? '+' : ''}${d} VP`);
  }
  if (after.philosophyTokens !== before.philosophyTokens) {
    const d = after.philosophyTokens - before.philosophyTokens;
    diffs.push(`${d > 0 ? '+' : ''}${d} scrolls`);
  }
  if (after.economyTrack !== before.economyTrack) {
    const d = after.economyTrack - before.economyTrack;
    diffs.push(`Economy ${before.economyTrack}→${after.economyTrack}`);
  }
  if (after.cultureTrack !== before.cultureTrack) {
    diffs.push(`Culture ${before.cultureTrack}→${after.cultureTrack}`);
  }
  if (after.militaryTrack !== before.militaryTrack) {
    diffs.push(`Military ${before.militaryTrack}→${after.militaryTrack}`);
  }
  if (after.taxTrack !== before.taxTrack) {
    const d = after.taxTrack - before.taxTrack;
    diffs.push(`${d > 0 ? '+' : ''}${d} tax`);
  }
  if (after.gloryTrack !== before.gloryTrack) {
    const d = after.gloryTrack - before.gloryTrack;
    diffs.push(`${d > 0 ? '+' : ''}${d} glory`);
  }
  if (after.troopTrack !== before.troopTrack) {
    const d = after.troopTrack - before.troopTrack;
    diffs.push(`${d > 0 ? '+' : ''}${d} troops`);
  }
  if (after.citizenTrack !== before.citizenTrack) {
    const d = after.citizenTrack - before.citizenTrack;
    diffs.push(`${d > 0 ? '+' : ''}${d} citizens`);
  }
  if (after.knowledgeTokens.length !== before.knowledgeTokens.length) {
    const d = after.knowledgeTokens.length - before.knowledgeTokens.length;
    diffs.push(`${d > 0 ? '+' : ''}${d} knowledge tokens`);
  }
  if (after.developmentLevel !== before.developmentLevel) {
    diffs.push(`Development ${before.developmentLevel}→${after.developmentLevel}`);
  }
  if (after.handCards.length !== before.handCards.length) {
    const d = after.handCards.length - before.handCards.length;
    diffs.push(`${d > 0 ? '+' : ''}${d} hand cards`);
  }
  if (after.playedCards.length !== before.playedCards.length) {
    const d = after.playedCards.length - before.playedCards.length;
    diffs.push(`${d > 0 ? '+' : ''}${d} played cards`);
  }

  if (diffs.length > 0) {
    s = appendLogEntry(s, {
      roundNumber,
      phase,
      playerId: pid,
      action: `${source}: ${diffs.join(', ')}`,
      details: { source, changes: diffs },
    });
  }

  return s;
}
