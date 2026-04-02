import { describe, it, expect } from 'vitest';
import { applyEffectToPlayer, applyEffectToAllPlayers } from './effects';
import { makeTestPlayer, makeTestGameState } from './test-helpers';
import type { GameEffect } from '@khora/shared';

describe('applyEffectToPlayer', () => {
  it('GAIN_COINS adds coins', () => {
    const player = makeTestPlayer({ coins: 5 });
    const effect: GameEffect = { type: 'GAIN_COINS', amount: 3 };
    const result = applyEffectToPlayer(player, effect);
    expect(result.coins).toBe(8);
  });

  it('LOSE_COINS subtracts coins', () => {
    const player = makeTestPlayer({ coins: 5 });
    const effect: GameEffect = { type: 'LOSE_COINS', amount: 3 };
    const result = applyEffectToPlayer(player, effect);
    expect(result.coins).toBe(2);
  });

  it('LOSE_COINS floors at 0', () => {
    const player = makeTestPlayer({ coins: 2 });
    const effect: GameEffect = { type: 'LOSE_COINS', amount: 10 };
    const result = applyEffectToPlayer(player, effect);
    expect(result.coins).toBe(0);
  });

  it('GAIN_CITIZENS adds citizen track levels', () => {
    const player = makeTestPlayer({ citizenTrack: 2 });
    const effect: GameEffect = { type: 'GAIN_CITIZENS', amount: 4 };
    const result = applyEffectToPlayer(player, effect);
    expect(result.citizenTrack).toBe(6);
  });

  it('LOSE_CITIZENS subtracts citizen track levels', () => {
    const player = makeTestPlayer({ citizenTrack: 5 });
    const effect: GameEffect = { type: 'LOSE_CITIZENS', amount: 3 };
    const result = applyEffectToPlayer(player, effect);
    expect(result.citizenTrack).toBe(2);
  });

  it('LOSE_CITIZENS floors at 0', () => {
    const player = makeTestPlayer({ citizenTrack: 1 });
    const effect: GameEffect = { type: 'LOSE_CITIZENS', amount: 5 };
    const result = applyEffectToPlayer(player, effect);
    expect(result.citizenTrack).toBe(0);
  });

  it('GAIN_PHILOSOPHY_TOKENS adds philosophy tokens', () => {
    const player = makeTestPlayer({ philosophyTokens: 1 });
    const effect: GameEffect = { type: 'GAIN_PHILOSOPHY_TOKENS', amount: 2 };
    const result = applyEffectToPlayer(player, effect);
    expect(result.philosophyTokens).toBe(3);
  });

  it('ADVANCE_TRACK advances economy', () => {
    const player = makeTestPlayer({ economyTrack: 3 });
    const effect: GameEffect = { type: 'ADVANCE_TRACK', track: 'ECONOMY', amount: 2 };
    const result = applyEffectToPlayer(player, effect);
    expect(result.economyTrack).toBe(5);
  });

  it('ADVANCE_TRACK advances culture', () => {
    const player = makeTestPlayer({ cultureTrack: 2 });
    const effect: GameEffect = { type: 'ADVANCE_TRACK', track: 'CULTURE', amount: 1 };
    const result = applyEffectToPlayer(player, effect);
    expect(result.cultureTrack).toBe(3);
  });

  it('ADVANCE_TRACK advances military', () => {
    const player = makeTestPlayer({ militaryTrack: 1 });
    const effect: GameEffect = { type: 'ADVANCE_TRACK', track: 'MILITARY', amount: 3 };
    const result = applyEffectToPlayer(player, effect);
    expect(result.militaryTrack).toBe(4);
  });

  it('GAIN_VP adds victory points', () => {
    const player = makeTestPlayer({ victoryPoints: 10 });
    const effect: GameEffect = { type: 'GAIN_VP', amount: 5 };
    const result = applyEffectToPlayer(player, effect);
    expect(result.victoryPoints).toBe(15);
  });

  it('COMPOSITE applies multiple effects in order', () => {
    const player = makeTestPlayer({ coins: 5, citizenTrack: 3 });
    const effect: GameEffect = {
      type: 'COMPOSITE',
      effects: [
        { type: 'GAIN_COINS', amount: 3 },
        { type: 'LOSE_CITIZENS', amount: 1 },
      ],
    };
    const result = applyEffectToPlayer(player, effect);
    expect(result.coins).toBe(8);
    expect(result.citizenTrack).toBe(2);
  });

  it('does not mutate the original player', () => {
    const player = makeTestPlayer({ coins: 5 });
    const effect: GameEffect = { type: 'GAIN_COINS', amount: 3 };
    applyEffectToPlayer(player, effect);
    expect(player.coins).toBe(5);
  });
});

describe('applyEffectToAllPlayers', () => {
  it('applies effect to all players', () => {
    const state = makeTestGameState({
      players: [
        makeTestPlayer({ playerId: 'p1', coins: 5 }),
        makeTestPlayer({ playerId: 'p2', coins: 10 }),
      ],
    });
    const effect: GameEffect = { type: 'GAIN_COINS', amount: 2 };

    const result = applyEffectToAllPlayers(state, effect);
    expect(result.players[0].coins).toBe(7);
    expect(result.players[1].coins).toBe(12);
  });

  it('does not mutate the original state', () => {
    const state = makeTestGameState({
      players: [makeTestPlayer({ coins: 5 })],
    });
    const effect: GameEffect = { type: 'GAIN_COINS', amount: 2 };

    applyEffectToAllPlayers(state, effect);
    expect(state.players[0].coins).toBe(5);
  });
});
