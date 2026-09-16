import { describe, expect, it } from 'vitest';
import type { ActionSlotTuple, GameState } from '@khora/shared';
import { DicePhaseManager } from './phases/dice-phase';
import { makeTestGameState, makeTestPlayer } from './test-helpers';
import { buildPublicGameState, getStateForPlayer } from './visibility';

function pendingAssignDice(playerId: string): GameState['pendingDecisions'][number] {
  return {
    playerId,
    decisionType: 'ASSIGN_DICE',
    timeoutAt: Date.now() + 60_000,
    options: null,
  };
}

function assignedSlots(): ActionSlotTuple {
  return [
    { actionType: 'POLITICS', assignedDie: 6, resolved: false, citizenCost: 0 },
    { actionType: 'TRADE', assignedDie: 4, resolved: false, citizenCost: 0 },
    null,
  ];
}

describe('dice assignment visibility', () => {
  it('keeps submitted actions hidden from other players until everyone locks in', () => {
    const players = [
      makeTestPlayer({
        playerId: 'player-1',
        playerName: 'Alice',
        diceRoll: [6, 4],
        actionSlots: assignedSlots(),
      }),
      makeTestPlayer({
        playerId: 'player-2',
        playerName: 'Bob',
        diceRoll: [2, 3],
      }),
    ];
    const state = makeTestGameState({
      currentPhase: 'DICE',
      players,
      turnOrder: players.map(player => player.playerId),
      pendingDecisions: [pendingAssignDice('player-2')],
    });

    const publicState = buildPublicGameState(state);
    expect(publicState.players.find(player => player.playerId === 'player-1')?.actionSlots).toEqual([]);

    const bobView = getStateForPlayer(state, 'player-2');
    expect(bobView.public.players.find(player => player.playerId === 'player-1')?.actionSlots).toEqual([]);

    const aliceView = getStateForPlayer(state, 'player-1');
    expect(aliceView.private.actionSlots[0]?.actionType).toBe('POLITICS');
  });

  it('reveals assigned actions once all dice assignments are submitted', () => {
    const players = [
      makeTestPlayer({
        playerId: 'player-1',
        playerName: 'Alice',
        diceRoll: [6, 4],
        actionSlots: assignedSlots(),
      }),
      makeTestPlayer({
        playerId: 'player-2',
        playerName: 'Bob',
        diceRoll: [2, 3],
      }),
    ];
    const state = makeTestGameState({
      currentPhase: 'ACTIONS',
      players,
      turnOrder: players.map(player => player.playerId),
      pendingDecisions: [],
    });

    const publicState = buildPublicGameState(state);

    expect(publicState.players.find(player => player.playerId === 'player-1')?.actionSlots).toEqual([
      { actionType: 'POLITICS', resolved: false },
      { actionType: 'TRADE', resolved: false },
    ]);
  });

  it('allows a submitted player to unassign while other assignments are still hidden', () => {
    const players = [
      makeTestPlayer({
        playerId: 'player-1',
        playerName: 'Alice',
        citizenTrack: 3,
        diceRoll: [6, 4],
        actionSlots: assignedSlots(),
      }),
      makeTestPlayer({
        playerId: 'player-2',
        playerName: 'Bob',
        diceRoll: [2, 3],
      }),
    ];
    const state = makeTestGameState({
      currentPhase: 'DICE',
      players,
      turnOrder: players.map(player => player.playerId),
      pendingDecisions: [pendingAssignDice('player-2')],
    });

    const result = new DicePhaseManager().handleDecision(state, 'player-1', { type: 'UNASSIGN_DICE' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pendingDecisions.map(decision => decision.playerId).sort()).toEqual(['player-1', 'player-2']);
    expect(buildPublicGameState(result.value).players.find(player => player.playerId === 'player-1')?.actionSlots).toEqual([]);
  });
});
