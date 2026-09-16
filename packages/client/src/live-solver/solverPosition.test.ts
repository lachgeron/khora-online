import { describe, expect, it } from 'vitest';
import { buildLiveSolverSnapshot } from '../../../server/src/live-solver-snapshot';
import { makeTestGameState } from '../../../server/src/test-helpers';
import { solverPositionKey } from './solverPosition';

describe('live solver position identity', () => {
  it('ignores timer and log noise', () => {
    const snapshot = buildLiveSolverSnapshot(makeTestGameState());
    snapshot.pendingDecisions = [{ playerId: 'player-1', decisionType: 'ASSIGN_DICE', options: null, timeoutAt: 10 }];
    const key = solverPositionKey(snapshot, 'player-1');
    snapshot.updatedAt++;
    snapshot.createdAt++;
    snapshot.players[0].timeBankMs--;
    snapshot.pendingDecisions[0].timeoutAt++;
    expect(solverPositionKey(snapshot, 'player-1')).toBe(key);
  });

  it('invalidates stale advice after any gameplay-relevant change', () => {
    const original = buildLiveSolverSnapshot(makeTestGameState());
    const key = solverPositionKey(original, 'player-1');
    const changes: Array<(snapshot: typeof original) => void> = [
      snapshot => { snapshot.players[0].coins++; },
      snapshot => { snapshot.players[0].philosophyTokens++; },
      snapshot => { snapshot.players[1].troopTrack++; },
      snapshot => { snapshot.availableAchievementIds.push('ach-12citizens'); },
      snapshot => { snapshot.progressSubmissions = { 'player-1': { skipped: true } }; },
      snapshot => { snapshot.politicsDeckIds.push('old-guard'); },
      snapshot => { snapshot.players[0].actionSlots[0] = { actionType: 'CULTURE', assignedDie: 2, citizenCost: 0, resolved: true }; },
      snapshot => { snapshot.predeterminedDice[2]['player-1'][0]++; },
    ];
    for (const change of changes) {
      const snapshot = structuredClone(original);
      change(snapshot);
      expect(solverPositionKey(snapshot, 'player-1')).not.toBe(key);
    }
  });
});
