import { describe, it, expect } from 'vitest';
import { drawCards, addToHand, playCardFromHand, dealForDraft } from './politics-market';
import { makeTestPlayer, makeTestGameState, makeTestPoliticsCard } from './test-helpers';
import type { PoliticsCard } from '@khora/shared';

function makeCard(id: string, cost = 3): PoliticsCard {
  return makeTestPoliticsCard(id, { cost });
}

describe('drawCards', () => {
  it('draws the specified number of cards from the deck', () => {
    const deck = [makeCard('c1'), makeCard('c2'), makeCard('c3')];
    const state = makeTestGameState({ politicsDeck: deck });

    const { cards, updatedState } = drawCards(state, 2);

    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe('c1');
    expect(cards[1].id).toBe('c2');
    expect(updatedState.politicsDeck).toHaveLength(1);
    expect(updatedState.politicsDeck[0].id).toBe('c3');
  });

  it('draws all cards when count equals deck size', () => {
    const deck = [makeCard('c1'), makeCard('c2')];
    const state = makeTestGameState({ politicsDeck: deck });

    const { cards, updatedState } = drawCards(state, 2);

    expect(cards).toHaveLength(2);
    expect(updatedState.politicsDeck).toHaveLength(0);
  });

  it('draws empty array when deck is empty', () => {
    const state = makeTestGameState({ politicsDeck: [] });

    const { cards, updatedState } = drawCards(state, 3);

    expect(cards).toHaveLength(0);
    expect(updatedState.politicsDeck).toHaveLength(0);
  });

  it('does not mutate the original state', () => {
    const deck = [makeCard('c1'), makeCard('c2')];
    const state = makeTestGameState({ politicsDeck: deck });

    drawCards(state, 1);

    expect(state.politicsDeck).toHaveLength(2);
  });
});

describe('addToHand', () => {
  it('adds a card to the player hand', () => {
    const player = makeTestPlayer({ handCards: [] });
    const card = makeCard('c1');

    const result = addToHand(player, card);

    expect(result.handCards).toHaveLength(1);
    expect(result.handCards[0].id).toBe('c1');
  });

  it('appends to existing hand cards', () => {
    const existing = makeCard('c1');
    const player = makeTestPlayer({ handCards: [existing] });
    const newCard = makeCard('c2');

    const result = addToHand(player, newCard);

    expect(result.handCards).toHaveLength(2);
    expect(result.handCards[1].id).toBe('c2');
  });

  it('does not mutate the original player', () => {
    const player = makeTestPlayer({ handCards: [] });
    const card = makeCard('c1');

    addToHand(player, card);

    expect(player.handCards).toHaveLength(0);
  });
});

describe('playCardFromHand', () => {
  it('moves a card from hand to played cards', () => {
    const card = makeCard('c1');
    const player = makeTestPlayer({ handCards: [card], playedCards: [] });

    const result = playCardFromHand(player, 'c1');

    expect(result).not.toBeNull();
    expect(result!.handCards).toHaveLength(0);
    expect(result!.playedCards).toHaveLength(1);
    expect(result!.playedCards[0].id).toBe('c1');
  });

  it('returns null when card is not in hand', () => {
    const player = makeTestPlayer({ handCards: [] });

    const result = playCardFromHand(player, 'nonexistent');

    expect(result).toBeNull();
  });

  it('handles multiple cards in hand', () => {
    const c1 = makeCard('c1');
    const c2 = makeCard('c2');
    const c3 = makeCard('c3');
    const player = makeTestPlayer({ handCards: [c1, c2, c3], playedCards: [] });

    const result = playCardFromHand(player, 'c2');

    expect(result).not.toBeNull();
    expect(result!.handCards).toHaveLength(2);
    expect(result!.handCards.map(c => c.id)).toEqual(['c1', 'c3']);
    expect(result!.playedCards).toHaveLength(1);
    expect(result!.playedCards[0].id).toBe('c2');
  });

  it('does not mutate the original player', () => {
    const card = makeCard('c1');
    const player = makeTestPlayer({ handCards: [card], playedCards: [] });

    playCardFromHand(player, 'c1');

    expect(player.handCards).toHaveLength(1);
    expect(player.playedCards).toHaveLength(0);
  });
});

describe('dealForDraft', () => {
  it('deals the specified number of cards to each player', () => {
    const deck = [
      makeCard('c1'), makeCard('c2'), makeCard('c3'),
      makeCard('c4'), makeCard('c5'), makeCard('c6'),
    ];
    const state = makeTestGameState({ politicsDeck: deck });

    const { hands, updatedState } = dealForDraft(state, 3);

    expect(hands.size).toBe(2); // 2 players by default
    expect(hands.get('player-1')).toHaveLength(3);
    expect(hands.get('player-2')).toHaveLength(3);
    expect(updatedState.politicsDeck).toHaveLength(0);
  });

  it('leaves remaining cards in deck', () => {
    const deck = Array.from({ length: 8 }, (_, i) => makeCard(`c${i + 1}`));
    const state = makeTestGameState({ politicsDeck: deck });

    const { hands, updatedState } = dealForDraft(state, 3);

    // 2 players * 3 cards = 6 dealt, 2 remaining
    expect(updatedState.politicsDeck).toHaveLength(2);
  });

  it('does not mutate the original state', () => {
    const deck = [makeCard('c1'), makeCard('c2'), makeCard('c3'), makeCard('c4')];
    const state = makeTestGameState({ politicsDeck: deck });

    dealForDraft(state, 2);

    expect(state.politicsDeck).toHaveLength(4);
  });
});
