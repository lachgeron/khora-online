import { describe, it, expect } from 'vitest';
import {
  buildPublicPlayerState,
  buildPrivatePlayerState,
  buildPublicGameState,
  getStateForPlayer,
} from './visibility';
import { makeTestPlayer, makeTestGameState } from './test-helpers';
import type { GameState, PlayerState } from '@khora/shared';

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return makeTestPlayer({
    playerId: 'p1',
    playerName: 'Alice',
    cityId: 'city1',
    coins: 10,
    knowledgeTokens: [],
    troopTrack: 4,
    citizenTrack: 5,
    economyTrack: 2,
    cultureTrack: 3,
    militaryTrack: 1,
    handCards: [
      { id: 'pc1', name: 'Card1', description: '', cost: 3, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'ONGOING', effect: { type: 'GAIN_VP', amount: 1 }, endGameScoring: null },
    ],
    diceRoll: [3, 5],
    actionSlots: [null, null, null],
    gloryTrack: 7,
    victoryPoints: 12,
    isConnected: true,
    ...overrides,
  });
}

function makeGameState(players: PlayerState[]): GameState {
  return makeTestGameState({
    gameId: 'game1',
    roundNumber: 3,
    currentPhase: 'ACTIONS',
    players,
    pendingDecisions: [
      { playerId: 'p1', decisionType: 'RESOLVE_ACTION', timeoutAt: 9999, options: {} },
    ],
    createdAt: 1000,
    updatedAt: 2000,
  });
}

describe('buildPublicPlayerState', () => {
  it('includes only public fields', () => {
    const player = makePlayer();
    const pub = buildPublicPlayerState(player);

    expect(pub.playerId).toBe('p1');
    expect(pub.playerName).toBe('Alice');
    expect(pub.cityId).toBe('city1');
    expect(pub.economyTrack).toBe(2);
    expect(pub.cultureTrack).toBe(3);
    expect(pub.militaryTrack).toBe(1);
    expect(pub.troopTrack).toBe(4);
    expect(pub.handCardCount).toBe(1);
    expect(pub.gloryTrack).toBe(7);
    expect(pub.victoryPoints).toBe(12);
    expect(pub.isConnected).toBe(true);
  });

  it('includes dice roll in public state', () => {
    const player = makePlayer();
    const pub = buildPublicPlayerState(player);

    expect(pub.diceRoll).toEqual([3, 5]);
  });

  it('does not expose private fields', () => {
    const player = makePlayer();
    const pub = buildPublicPlayerState(player) as unknown as Record<string, unknown>;

    expect(pub).not.toHaveProperty('coins');
    expect(pub).not.toHaveProperty('knowledgeTokens');
    expect(pub).not.toHaveProperty('handCards');
    expect(pub).not.toHaveProperty('playedCards');
    // actionSlots is public (shows action types + resolved, not die values)
    expect(pub).toHaveProperty('actionSlots');
    // playedCardSummaries is public (names + types only)
    expect(pub).toHaveProperty('playedCardSummaries');
  });
});

describe('buildPrivatePlayerState', () => {
  it('includes private fields', () => {
    const player = makePlayer();
    const priv = buildPrivatePlayerState(player);

    expect(priv.coins).toBe(10);
    expect(priv.knowledgeTokens).toEqual([]);
    expect(priv.diceRoll).toEqual([3, 5]);
    expect(priv.handCards).toHaveLength(1);
  });

  it('does not expose public-only fields', () => {
    const player = makePlayer();
    const priv = buildPrivatePlayerState(player) as unknown as Record<string, unknown>;

    expect(priv).not.toHaveProperty('playerId');
    expect(priv).not.toHaveProperty('economyTrack');
    expect(priv).not.toHaveProperty('troopTrack');
    expect(priv).not.toHaveProperty('victoryPoints');
  });
});

describe('buildPublicGameState', () => {
  it('maps all players to public state', () => {
    const p1 = makePlayer({ playerId: 'p1' });
    const p2 = makePlayer({ playerId: 'p2', coins: 20, diceRoll: [1, 6] });
    const state = makeGameState([p1, p2]);
    const pub = buildPublicGameState(state);

    expect(pub.players).toHaveLength(2);
    expect(pub.players[0].playerId).toBe('p1');
    expect(pub.players[1].playerId).toBe('p2');

    // No private info in public player states (but diceRoll IS public now)
    for (const pp of pub.players) {
      const record = pp as unknown as Record<string, unknown>;
      expect(record).not.toHaveProperty('coins');
    }
    expect(pub.players[0].diceRoll).toEqual([3, 5]);
    expect(pub.players[1].diceRoll).toEqual([1, 6]);
  });

  it('includes game-level public info', () => {
    const state = makeGameState([makePlayer()]);
    const pub = buildPublicGameState(state);

    expect(pub.roundNumber).toBe(3);
    expect(pub.currentPhase).toBe('ACTIONS');
    expect(pub.gameLog).toEqual([]);
  });

  it('strips options from pending decisions', () => {
    const state = makeGameState([makePlayer()]);
    const pub = buildPublicGameState(state);

    expect(pub.pendingDecisions).toHaveLength(1);
    expect(pub.pendingDecisions[0]).toEqual({
      playerId: 'p1',
      decisionType: 'RESOLVE_ACTION',
      timeoutAt: 9999,
    });
    expect((pub.pendingDecisions[0] as Record<string, unknown>)).not.toHaveProperty('options');
  });
});

describe('getStateForPlayer', () => {
  it('returns private state only for the requesting player', () => {
    const p1 = makePlayer({ playerId: 'p1', coins: 10, diceRoll: [2, 4] });
    const p2 = makePlayer({ playerId: 'p2', coins: 20, diceRoll: [1, 6] });
    const state = makeGameState([p1, p2]);

    const view1 = getStateForPlayer(state, 'p1');
    expect(view1.private.coins).toBe(10);
    expect(view1.private.diceRoll).toEqual([2, 4]);

    const view2 = getStateForPlayer(state, 'p2');
    expect(view2.private.coins).toBe(20);
    expect(view2.private.diceRoll).toEqual([1, 6]);
  });

  it('does not leak other players private info in public state', () => {
    const p1 = makePlayer({ playerId: 'p1', coins: 10 });
    const p2 = makePlayer({ playerId: 'p2', coins: 99 });
    const state = makeGameState([p1, p2]);

    const view1 = getStateForPlayer(state, 'p1');
    // p2's coins should not appear anywhere in p1's view (but diceRoll is public)
    for (const pp of view1.public.players) {
      const record = pp as unknown as Record<string, unknown>;
      expect(record).not.toHaveProperty('coins');
      expect(record).not.toHaveProperty('knowledgeTokens');
    }
  });

  it('returns default private state for unknown player', () => {
    const state = makeGameState([makePlayer()]);
    const view = getStateForPlayer(state, 'unknown');

    expect(view.private.coins).toBe(0);
    expect(view.private.knowledgeTokens).toEqual([]);
    expect(view.private.diceRoll).toBeNull();
    expect(view.private.handCards).toEqual([]);
  });
});
