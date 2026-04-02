/**
 * Persistence layer for Khora Online game state.
 *
 * Provides an interface-based approach with an InMemoryPersistenceLayer for
 * testing and a PostgresPersistenceLayer stub for future DB integration.
 * Includes retry logic with exponential backoff.
 */

import type { GameState } from '@khora/shared';
import { serializeGameState, deserializeGameState } from './serialization';

/** Interface for game state persistence operations. */
export interface PersistenceLayer {
  saveGameState(gameId: string, state: GameState): Promise<void>;
  loadGameState(gameId: string): Promise<GameState | null>;
  deleteGameState(gameId: string): Promise<void>;
}

/**
 * Retry a function up to `maxRetries` times with exponential backoff.
 * Base delay doubles each attempt: baseMs, baseMs*2, baseMs*4, ...
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseMs: number = 100,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, baseMs * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

/** In-memory persistence layer for testing. */
export class InMemoryPersistenceLayer implements PersistenceLayer {
  private store = new Map<string, string>();

  async saveGameState(gameId: string, state: GameState): Promise<void> {
    this.store.set(gameId, serializeGameState(state));
  }

  async loadGameState(gameId: string): Promise<GameState | null> {
    const json = this.store.get(gameId);
    if (!json) return null;
    return deserializeGameState(json);
  }

  async deleteGameState(gameId: string): Promise<void> {
    this.store.delete(gameId);
  }
}

/** Stub PostgreSQL persistence layer — actual DB connection deferred. */
export class PostgresPersistenceLayer implements PersistenceLayer {
  async saveGameState(_gameId: string, _state: GameState): Promise<void> {
    throw new Error('PostgresPersistenceLayer not implemented');
  }

  async loadGameState(_gameId: string): Promise<GameState | null> {
    throw new Error('PostgresPersistenceLayer not implemented');
  }

  async deleteGameState(_gameId: string): Promise<void> {
    throw new Error('PostgresPersistenceLayer not implemented');
  }
}
