/**
 * Politics card hand management for Khora Online.
 *
 * In the official rules, there is no market — cards are drafted at setup
 * and drawn from a deck via the Legislation action. Cards are played
 * from the player's hand during the Politics action.
 */

import type { GameState, PoliticsCard, PlayerState } from '@khora/shared';

/**
 * Draws the top N cards from the politics deck.
 * Returns the drawn cards and updated deck.
 */
export function drawCards(
  state: GameState,
  count: number,
): { cards: PoliticsCard[]; updatedState: GameState } {
  const drawn = state.politicsDeck.slice(0, count);
  const remaining = state.politicsDeck.slice(count);
  return {
    cards: drawn,
    updatedState: { ...state, politicsDeck: remaining },
  };
}

/**
 * Adds a card to a player's hand. Returns updated player.
 */
export function addToHand(player: PlayerState, card: PoliticsCard): PlayerState {
  return { ...player, handCards: [...player.handCards, card] };
}

/**
 * Removes a card from a player's hand and adds it to played cards.
 * Returns null if the card is not in the player's hand.
 */
export function playCardFromHand(
  player: PlayerState,
  cardId: string,
): PlayerState | null {
  const cardIndex = player.handCards.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return null;

  const card = player.handCards[cardIndex];
  const updatedHand = [
    ...player.handCards.slice(0, cardIndex),
    ...player.handCards.slice(cardIndex + 1),
  ];

  return {
    ...player,
    handCards: updatedHand,
    playedCards: [...player.playedCards, card],
  };
}

/**
 * Sets up initial card drafting: deals cardCount cards to each player
 * from the politics deck. Returns the dealt hands and updated state.
 */
export function dealForDraft(
  state: GameState,
  cardsPerPlayer: number,
): { hands: Map<string, PoliticsCard[]>; updatedState: GameState } {
  const hands = new Map<string, PoliticsCard[]>();
  let deckOffset = 0;

  for (const player of state.players) {
    const playerCards = state.politicsDeck.slice(deckOffset, deckOffset + cardsPerPlayer);
    hands.set(player.playerId, playerCards);
    deckOffset += cardsPerPlayer;
  }

  return {
    hands,
    updatedState: {
      ...state,
      politicsDeck: state.politicsDeck.slice(deckOffset),
    },
  };
}
