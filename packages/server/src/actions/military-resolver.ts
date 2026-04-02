/**
 * Military action resolver (Action 4).
 *
 * Per the official rules:
 * 1. Gain troops equal to military track level
 * 2. Optionally explore a Knowledge token on the central board
 *    (requires troops >= token requirement, lose troops = skull value)
 *
 * This is the ONLY action resolved in turn order (not simultaneously).
 */

import type { ActionChoices, ActionCostResult, GameError, GameState, Result } from '@khora/shared';
import { ACTION_NUMBERS } from '@khora/shared';
import type { ActionResolver } from './action-resolver';
import { advanceTrack } from '../resources';
import { explore } from '../knowledge-tokens';

export class MilitaryResolver implements ActionResolver {
  readonly actionNumber = ACTION_NUMBERS.MILITARY; // 4
  readonly actionType = 'MILITARY' as const;

  canPerform(_state: GameState, _playerId: string, dieValue: number): ActionCostResult {
    const citizenCost = Math.max(0, this.actionNumber - dieValue);
    return { canPerform: true, citizenCost };
  }

  resolve(state: GameState, playerId: string, choices: ActionChoices): Result<GameState, GameError> {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };
    }

    let updatedState = state;
    let player = state.players[playerIndex];

    // Step 1: Gain troops equal to military track level
    const troopGain = player.militaryTrack;
    player = advanceTrack(player, 'TROOP', troopGain);

    const updatedPlayers = [...updatedState.players];
    updatedPlayers[playerIndex] = player;
    updatedState = { ...updatedState, players: updatedPlayers };

    // Step 2: Optionally explore a knowledge token (costs troops)
    if (choices.explorationTokenId) {
      const exploreResult = explore(updatedState, playerId, choices.explorationTokenId);
      if (!exploreResult.ok) {
        return exploreResult;
      }
      updatedState = exploreResult.value;
    }

    return { ok: true, value: updatedState };
  }
}
