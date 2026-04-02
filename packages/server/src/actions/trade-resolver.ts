/**
 * Trade action resolver (Action 3).
 *
 * Per the official rules:
 * 1. Gain drachmas equal to economy track level + 1
 * 2. Optionally buy 1 Minor Knowledge token for 5 drachmas
 */

import type { ActionChoices, ActionCostResult, GameError, GameState, Result } from '@khora/shared';
import { ACTION_NUMBERS, MINOR_KNOWLEDGE_COST } from '@khora/shared';
import type { ActionResolver } from './action-resolver';
import { addCoins, subtractCoins, addKnowledgeToken } from '../resources';
import { createMinorToken } from '../knowledge-tokens';
import { hasCardInPlay } from '../card-handlers';

export class TradeResolver implements ActionResolver {
  readonly actionNumber = ACTION_NUMBERS.TRADE; // 3
  readonly actionType = 'TRADE' as const;

  canPerform(_state: GameState, _playerId: string, dieValue: number): ActionCostResult {
    const citizenCost = Math.max(0, this.actionNumber - dieValue);
    return { canPerform: true, citizenCost };
  }

  resolve(state: GameState, playerId: string, choices: ActionChoices): Result<GameState, GameError> {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };
    }

    let player = state.players[playerIndex];

    // Step 1: Gain drachmas = economy level + 1
    const coinsGained = player.economyTrack + 1;
    player = addCoins(player, coinsGained);

    // Step 2: Optionally buy a Minor Knowledge token
    if (choices.buyMinorKnowledge && choices.minorKnowledgeColor) {
      const hasCorinthianColumns = hasCardInPlay(player, 'corinthian-columns');
      const tokenCost = hasCorinthianColumns ? 3 : MINOR_KNOWLEDGE_COST;
      const buyResult = subtractCoins(player, tokenCost);
      if (!buyResult.ok) {
        return { ok: false, error: buyResult.error };
      }
      player = buyResult.value;
      const token = createMinorToken(choices.minorKnowledgeColor);
      player = addKnowledgeToken(player, token);
    }

    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = player;

    return { ok: true, value: { ...state, players: updatedPlayers } };
  }
}
