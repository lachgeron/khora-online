/**
 * Legislation action resolver (Action 1).
 *
 * Per the official rules:
 * 1. Gain 3 citizens (citizen track)
 * 2. Draw 2 politics cards from the deck, keep 1, discard 1
 */

import type { ActionChoices, ActionCostResult, GameError, GameState, Result } from '@khora/shared';
import { ACTION_NUMBERS } from '@khora/shared';
import type { ActionResolver } from './action-resolver';
import { addCitizens } from '../resources';
import { drawCards, addToHand } from '../politics-market';

const CITIZENS_GAINED = 3;
const CARDS_DRAWN = 2;

export class LegislationResolver implements ActionResolver {
  readonly actionNumber = ACTION_NUMBERS.LEGISLATION; // 1
  readonly actionType = 'LEGISLATION' as const;

  canPerform(state: GameState, playerId: string, dieValue: number): ActionCostResult {
    const citizenCost = Math.max(0, this.actionNumber - dieValue);
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return { canPerform: false, citizenCost, reason: 'Player not found' };

    if (state.politicsDeck.length === 0) {
      return { canPerform: false, citizenCost, reason: 'No cards left in politics deck' };
    }

    return { canPerform: true, citizenCost };
  }

  resolve(state: GameState, playerId: string, choices: ActionChoices): Result<GameState, GameError> {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };
    }

    let updatedState = state;
    let player = state.players[playerIndex];

    // Step 1: Gain 3 citizens
    player = addCitizens(player, CITIZENS_GAINED);

    // Step 2: Draw 2 cards (or fewer if deck is small)
    const drawCount = Math.min(CARDS_DRAWN, updatedState.politicsDeck.length);
    const { cards: drawnCards, updatedState: stateAfterDraw } = drawCards(updatedState, drawCount);
    updatedState = stateAfterDraw;

    // Step 3: Keep chosen card, put the other on the bottom of the deck
    if (drawnCards.length > 0) {
      let chosenCard: typeof drawnCards[0];
      if (choices.targetCardId) {
        const found = drawnCards.find(c => c.id === choices.targetCardId);
        chosenCard = found ?? drawnCards[0];
      } else {
        chosenCard = drawnCards[0];
      }

      // Guard against duplicates: if the chosen card is already in the
      // player's hand (state corruption), skip adding and return it to deck.
      const alreadyInHand = player.handCards.some(c => c.id === chosenCard.id);
      if (!alreadyInHand) {
        player = addToHand(player, chosenCard);
      } else {
        console.warn(`[LEGISLATION] Card "${chosenCard.id}" already in hand, returning to deck`);
      }

      // Put unchosen cards (and the duplicate, if any) on the bottom of the deck
      const unchosenCards = alreadyInHand
        ? drawnCards
        : drawnCards.filter(c => c.id !== chosenCard.id);
      const updatedDeck = [...updatedState.politicsDeck, ...unchosenCards];
      updatedState = { ...updatedState, politicsDeck: updatedDeck };
    }

    const updatedPlayers = [...updatedState.players];
    updatedPlayers[playerIndex] = player;

    return { ok: true, value: { ...updatedState, players: updatedPlayers } };
  }
}
