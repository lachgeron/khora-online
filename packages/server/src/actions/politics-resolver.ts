/**
 * Politics action resolver (Action 5).
 *
 * Per the official rules:
 * - Play a politics card from the player's HAND (not a market)
 * - Verify knowledge token requirements (tokens NOT spent)
 * - Pay the drachma cost shown on the card
 * - Apply the card's effect based on type
 */

import type { ActionChoices, ActionCostResult, GameError, GameState, Result } from '@khora/shared';
import { ACTION_NUMBERS } from '@khora/shared';
import type { ActionResolver } from './action-resolver';
import { subtractCoins, meetsKnowledgeRequirement, subtractPhilosophyTokens } from '../resources';
import { playCardFromHand } from '../politics-market';
import { applyEffectToPlayer } from '../effects';
import { applyImmediateCardEffect, applyOngoingEffects } from '../card-handlers';

export class PoliticsResolver implements ActionResolver {
  readonly actionNumber = ACTION_NUMBERS.POLITICS; // 5
  readonly actionType = 'POLITICS' as const;

  canPerform(state: GameState, playerId: string, dieValue: number): ActionCostResult {
    const citizenCost = Math.max(0, this.actionNumber - dieValue);
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return { canPerform: false, citizenCost, reason: 'Player not found' };

    if (player.handCards.length === 0) {
      return { canPerform: false, citizenCost, reason: 'No cards in hand' };
    }

    const hasPlayableCard = player.handCards.some(card => {
      if (player.coins < card.cost) return false;
      if (meetsKnowledgeRequirement(player, card.knowledgeRequirement)) return true;
      // Check if scrolls can cover the shortfall
      const greenCount = player.knowledgeTokens.filter(t => t.color === 'GREEN').length;
      const blueCount = player.knowledgeTokens.filter(t => t.color === 'BLUE').length;
      const redCount = player.knowledgeTokens.filter(t => t.color === 'RED').length;
      const shortfall = Math.max(0, card.knowledgeRequirement.green - greenCount)
        + Math.max(0, card.knowledgeRequirement.blue - blueCount)
        + Math.max(0, card.knowledgeRequirement.red - redCount);
      return player.philosophyTokens >= shortfall * 2;
    });

    if (!hasPlayableCard) {
      return { canPerform: false, citizenCost, reason: 'No affordable/qualified cards in hand' };
    }

    return { canPerform: true, citizenCost };
  }

  resolve(state: GameState, playerId: string, choices: ActionChoices): Result<GameState, GameError> {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };
    }

    if (!choices.targetCardId) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'No card selected to play' } };
    }

    let player = state.players[playerIndex];
    const card = player.handCards.find(c => c.id === choices.targetCardId);
    if (!card) {
      return { ok: false, error: { code: 'CARD_NOT_IN_HAND', message: 'Card not found in hand' } };
    }

    const pairsToUse = choices.philosophyPairsToUse ?? 0;
    if (!meetsKnowledgeRequirement(player, card.knowledgeRequirement, pairsToUse)) {
      return {
        ok: false,
        error: { code: 'INSUFFICIENT_KNOWLEDGE', message: 'Knowledge token requirements not met' },
      };
    }

    // Deduct philosophy tokens used to cover knowledge shortfall
    if (pairsToUse > 0) {
      const philResult = subtractPhilosophyTokens(player, pairsToUse * 2);
      if (!philResult.ok) return { ok: false, error: philResult.error };
      player = philResult.value;
    }

    const costResult = subtractCoins(player, card.cost);
    if (!costResult.ok) return { ok: false, error: costResult.error };
    player = costResult.value;

    const afterPlay = playCardFromHand(player, choices.targetCardId);
    if (!afterPlay) {
      return { ok: false, error: { code: 'CARD_NOT_IN_HAND', message: 'Card not in hand' } };
    }
    player = afterPlay;

    if (card.type === 'IMMEDIATE') {
      // Apply the card's dedicated handler (handles complex effects)
      let updatedState: GameState = { ...state, players: [...state.players] };
      updatedState.players[playerIndex] = player;
      updatedState = applyImmediateCardEffect(updatedState, playerId, card.id, choices);
      player = updatedState.players[playerIndex];
    }

    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = player;
    let finalState = { ...state, players: updatedPlayers };

    // Trigger ON_PLAY_CARD ongoing effects (e.g., Extraordinary Collection)
    // Exclude the card just played so it doesn't trigger for itself
    finalState = applyOngoingEffects(finalState, playerId, { type: 'ON_PLAY_CARD' }, choices.targetCardId);

    return { ok: true, value: finalState };
  }
}
