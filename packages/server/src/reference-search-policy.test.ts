import { describe, expect, it } from 'vitest';
import { generatedSeedForIteration, referenceScenarioIdentity } from './reference-search-policy';
import { makeTestGameState, makeTestPlayer } from './test-helpers';

describe('offline reference search continuity', () => {
  it('uses the persisted iteration count for revisits across restarted child processes', () => {
    expect(generatedSeedForIteration(1, 2, 3, [11, 22])).toBe(2);
    expect(generatedSeedForIteration(1, 3, 3, [11, 22])).toBe(11);
    expect(generatedSeedForIteration(1, 6, 3, [11, 22])).toBe(22);
    expect(generatedSeedForIteration(1, 9, 3, [11, 22])).toBe(11);
    expect(generatedSeedForIteration(1, 3, 0, [11])).toBe(3);
  });

  it('recognizes the same scenario with new player IDs but distinguishes resources', () => {
    const a = makeTestGameState({ players: [makeTestPlayer({ playerId: 'session-a' })] });
    const b = makeTestGameState({ players: [makeTestPlayer({ playerId: 'session-b' })] });
    expect(referenceScenarioIdentity(a)).toBe(referenceScenarioIdentity(b));
    b.players[0].coins++;
    expect(referenceScenarioIdentity(a)).not.toBe(referenceScenarioIdentity(b));
  });
});
