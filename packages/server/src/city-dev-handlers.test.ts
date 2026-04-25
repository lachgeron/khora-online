import { describe, it, expect } from 'vitest';
import { DEV_IMMEDIATE_HANDLERS } from './city-dev-handlers';
import { makeTestGameState, makeTestKnowledgeToken, makeTestPlayer } from './test-helpers';

describe('DEV_IMMEDIATE_HANDLERS', () => {
  it('corinth-dev-2 grants taxes and scrolls equal to knowledge token count', () => {
    const player = makeTestPlayer({
      cityId: 'corinth',
      taxTrack: 1,
      philosophyTokens: 2,
      knowledgeTokens: [
        makeTestKnowledgeToken({ id: 'green-1', color: 'GREEN' }),
        makeTestKnowledgeToken({ id: 'blue-1', color: 'BLUE' }),
        makeTestKnowledgeToken({ id: 'red-1', color: 'RED' }),
      ],
    });
    const state = makeTestGameState({ players: [player] });

    const result = DEV_IMMEDIATE_HANDLERS['corinth-dev-2'](state, 'player-1');

    expect(result.players[0].taxTrack).toBe(4);
    expect(result.players[0].philosophyTokens).toBe(5);
  });

  it('corinth-dev-2 caps taxes at 10', () => {
    const player = makeTestPlayer({
      cityId: 'corinth',
      taxTrack: 9,
      knowledgeTokens: [
        makeTestKnowledgeToken({ id: 'green-1', color: 'GREEN' }),
        makeTestKnowledgeToken({ id: 'blue-1', color: 'BLUE' }),
      ],
    });
    const state = makeTestGameState({ players: [player] });

    const result = DEV_IMMEDIATE_HANDLERS['corinth-dev-2'](state, 'player-1');

    expect(result.players[0].taxTrack).toBe(10);
    expect(result.players[0].philosophyTokens).toBe(2);
  });
});
