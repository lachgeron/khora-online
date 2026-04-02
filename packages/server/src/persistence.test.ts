import { describe, it, expect } from 'vitest';
import { InMemoryPersistenceLayer, PostgresPersistenceLayer, withRetry } from './persistence';
import { makeTestGameState } from './test-helpers';
import type { GameState } from '@khora/shared';

function makeTestState(): GameState {
  return makeTestGameState({
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  });
}

describe('InMemoryPersistenceLayer', () => {
  it('saves and loads a game state', async () => {
    const layer = new InMemoryPersistenceLayer();
    const state = makeTestState();
    await layer.saveGameState('game-1', state);
    const loaded = await layer.loadGameState('game-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.gameId).toBe('game-1');
    expect(loaded!.roundNumber).toBe(1);
  });

  it('returns null for unknown game', async () => {
    const layer = new InMemoryPersistenceLayer();
    const loaded = await layer.loadGameState('nonexistent');
    expect(loaded).toBeNull();
  });

  it('deletes a game state', async () => {
    const layer = new InMemoryPersistenceLayer();
    await layer.saveGameState('game-1', makeTestState());
    await layer.deleteGameState('game-1');
    const loaded = await layer.loadGameState('game-1');
    expect(loaded).toBeNull();
  });

  it('overwrites on re-save', async () => {
    const layer = new InMemoryPersistenceLayer();
    const state1 = makeTestState();
    await layer.saveGameState('game-1', state1);
    const state2 = { ...state1, roundNumber: 5 };
    await layer.saveGameState('game-1', state2);
    const loaded = await layer.loadGameState('game-1');
    expect(loaded!.roundNumber).toBe(5);
  });

  it('preserves Maps through save/load cycle', async () => {
    const layer = new InMemoryPersistenceLayer();
    const state = makeTestState();
    state.claimedAchievements.set('p1', []);
    state.disconnectedPlayers.set('p2', { disconnectedAt: 100, expiresAt: 400 });
    await layer.saveGameState('game-1', state);
    const loaded = await layer.loadGameState('game-1');
    expect(loaded!.claimedAchievements).toBeInstanceOf(Map);
    expect(loaded!.disconnectedPlayers).toBeInstanceOf(Map);
    expect(loaded!.disconnectedPlayers.get('p2')).toEqual({ disconnectedAt: 100, expiresAt: 400 });
  });
});

describe('PostgresPersistenceLayer', () => {
  it('throws not implemented for saveGameState', async () => {
    const layer = new PostgresPersistenceLayer();
    await expect(layer.saveGameState('g', makeTestState())).rejects.toThrow('not implemented');
  });

  it('throws not implemented for loadGameState', async () => {
    const layer = new PostgresPersistenceLayer();
    await expect(layer.loadGameState('g')).rejects.toThrow('not implemented');
  });

  it('throws not implemented for deleteGameState', async () => {
    const layer = new PostgresPersistenceLayer();
    await expect(layer.deleteGameState('g')).rejects.toThrow('not implemented');
  });
});

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const result = await withRetry(() => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it('retries on failure and succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw new Error('fail');
      return 'ok';
    }, 3, 10);
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('throws after exhausting retries', async () => {
    await expect(
      withRetry(() => Promise.reject(new Error('always fails')), 3, 10),
    ).rejects.toThrow('always fails');
  });
});
