/**
 * Culture action resolver (Action 2).
 *
 * Grants VP equal to the player's culture track level.
 */

import type { ActionChoices, ActionCostResult, GameError, GameState, Result } from '@khora/shared';
import { ACTION_NUMBERS } from '@khora/shared';
import type { ActionResolver } from './action-resolver';
import { addVP } from '../resources';

export class CultureResolver implements ActionResolver {
  readonly actionNumber = ACTION_NUMBERS.CULTURE; // 2
  readonly actionType = 'CULTURE' as const;

  canPerform(_state: GameState, _playerId: string, dieValue: number): ActionCostResult {
    const citizenCost = Math.max(0, this.actionNumber - dieValue);
    return { canPerform: true, citizenCost };
  }

  resolve(state: GameState, playerId: string, _choices: ActionChoices): Result<GameState, GameError> {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };
    }

    const player = state.players[playerIndex];
    const vpGained = player.cultureTrack;
    const updatedPlayer = addVP(player, vpGained);
    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = updatedPlayer;

    return { ok: true, value: { ...state, players: updatedPlayers } };
  }
}
