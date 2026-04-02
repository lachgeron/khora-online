/**
 * Philosophy action resolver (Action 0).
 *
 * Grants philosophy tokens to the player.
 * Philosophy tokens have 3 uses (handled elsewhere):
 * 1. During Dice phase: spend tokens for 3 citizens each
 * 2. During Politics/Development: spend pairs to ignore 1 knowledge requirement
 * 3. During Progress: spend to advance additional track levels
 */

import type { ActionChoices, ActionCostResult, GameError, GameState, Result } from '@khora/shared';
import { ACTION_NUMBERS } from '@khora/shared';
import type { ActionResolver } from './action-resolver';
import { addPhilosophyTokens } from '../resources';

const PHILOSOPHY_TOKENS_GRANTED = 1;

export class PhilosophyResolver implements ActionResolver {
  readonly actionNumber = ACTION_NUMBERS.PHILOSOPHY; // 0
  readonly actionType = 'PHILOSOPHY' as const;

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
    const updatedPlayer = addPhilosophyTokens(player, PHILOSOPHY_TOKENS_GRANTED);
    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = updatedPlayer;

    return { ok: true, value: { ...state, players: updatedPlayers } };
  }
}
