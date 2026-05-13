import { describe, expect, it } from 'vitest';
import type { GameState } from '@khora/shared';
import { ALL_POLITICS_CARDS } from './game-data';
import { ProgressPhaseManager } from './phases/progress-phase';
import { calculateFinalScores } from './scoring-engine';
import { makeTestGameState, makeTestPlayer } from './test-helpers';

function pendingProgress(playerId: string): GameState['pendingDecisions'][number] {
  return {
    playerId,
    decisionType: 'PROGRESS_TRACK',
    timeoutAt: Date.now() + 30_000,
    options: null as unknown,
  };
}

describe('progress phase locking', () => {
  it('keeps locked progress hidden until every player has submitted', () => {
    const players = [
      makeTestPlayer({ playerId: 'player-1', playerName: 'Alice', coins: 4, economyTrack: 1, citizenTrack: 3 }),
      makeTestPlayer({ playerId: 'player-2', playerName: 'Bob', coins: 4, economyTrack: 1, citizenTrack: 3 }),
    ];
    const state = makeTestGameState({
      currentPhase: 'PROGRESS',
      roundNumber: 2,
      players,
      turnOrder: players.map(player => player.playerId),
      pendingDecisions: players.map(player => pendingProgress(player.playerId)),
      progressSubmissions: {},
    });

    const manager = new ProgressPhaseManager();
    const afterAlice = manager.handleDecision(state, 'player-1', {
      type: 'PROGRESS_TRACK',
      advancement: { track: 'ECONOMY' },
    });

    expect(afterAlice.ok).toBe(true);
    if (!afterAlice.ok) return;
    expect(afterAlice.value.players[0].economyTrack).toBe(1);
    expect(afterAlice.value.players[0].coins).toBe(4);
    expect(afterAlice.value.progressSubmissions?.['player-1']?.advancement?.track).toBe('ECONOMY');
    expect(afterAlice.value.pendingDecisions.map(decision => decision.playerId)).toEqual(['player-2']);
    expect(afterAlice.value.gameLog).toHaveLength(0);

    const undo = manager.handleDecision(afterAlice.value, 'player-1', { type: 'UNDO_PROGRESS' });
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    expect(undo.value.players[0].economyTrack).toBe(1);
    expect(undo.value.progressSubmissions?.['player-1']).toBeUndefined();
    expect(undo.value.pendingDecisions.map(decision => decision.playerId).sort()).toEqual(['player-1', 'player-2']);

    const resubmitted = manager.handleDecision(undo.value, 'player-1', {
      type: 'PROGRESS_TRACK',
      advancement: { track: 'ECONOMY' },
    });
    expect(resubmitted.ok).toBe(true);
    if (!resubmitted.ok) return;

    const afterBob = manager.handleDecision(resubmitted.value, 'player-2', { type: 'SKIP_PHASE' });
    expect(afterBob.ok).toBe(true);
    if (!afterBob.ok) return;

    expect(afterBob.value.pendingDecisions).toHaveLength(1);
    expect(afterBob.value.pendingDecisions[0].decisionType).toBe('PHASE_DISPLAY');
    expect(afterBob.value.progressSubmissions).toEqual({});
    expect(afterBob.value.players[0].economyTrack).toBe(2);
    expect(afterBob.value.players[0].coins).toBe(2);
    expect(afterBob.value.players[0].citizenTrack).toBe(6);
    expect(afterBob.value.gameLog.some(entry => entry.action.includes('Advanced ECONOMY'))).toBe(true);
  });
});

describe('Central Government scoring', () => {
  it('counts the Central Government card once because it is already in play', () => {
    const centralGovernment = ALL_POLITICS_CARDS.find(card => card.id === 'central-government');
    const ostracism = ALL_POLITICS_CARDS.find(card => card.id === 'ostracism');
    expect(centralGovernment).toBeDefined();
    expect(ostracism).toBeDefined();
    if (!centralGovernment || !ostracism) return;

    const player = makeTestPlayer({
      playedCards: [centralGovernment, ostracism],
      victoryPoints: 0,
    });
    const state = makeTestGameState({ players: [player] });

    const scores = calculateFinalScores(state);

    expect(scores.rankings[0].breakdown.politicsCardPoints).toBe(4);
    expect(scores.rankings[0].totalPoints).toBe(4);
  });
});
