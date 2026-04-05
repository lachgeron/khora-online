/**
 * TaxationPhaseManager — handles the Taxation phase (Phase B) of each round.
 *
 * Per the official rules:
 * Each player gains drachmas equal to their Tax Track level.
 * No citizen/population distribution — citizens are gained via Legislation action.
 */

import type { ClientMessage, GameState, Result, GameError } from '@khora/shared';
import type { PhaseManager } from './omen-phase';
import { addCoins } from '../resources';
import { applyAllTaxPhaseOngoing } from '../card-handlers';
import { appendLogEntry } from '../game-log';

export class TaxationPhaseManager implements PhaseManager {
  onEnter(state: GameState): GameState {
    const roundNumber = state.roundNumber;
    let updatedState = {
      ...state,
      players: state.players.map(player => {
        const taxIncome = player.taxTrack;
        return addCoins(player, taxIncome);
      }),
    };

    // Log tax income for each player
    for (const player of state.players) {
      const taxIncome = player.taxTrack;
      updatedState = appendLogEntry(updatedState, { roundNumber, phase: 'TAXATION', playerId: player.playerId, action: `Gained ${taxIncome} drachma from taxes`, details: { taxIncome } });
    }

    // Apply ongoing card effects that trigger during tax phase
    updatedState = applyAllTaxPhaseOngoing(updatedState);

    // Log any bonuses from ongoing card effects by comparing with pre-ongoing state
    for (const player of state.players) {
      const after = updatedState.players.find(p => p.playerId === player.playerId);
      if (!after) continue;
      const preOngoing = addCoins(player, player.taxTrack); // state after tax income but before ongoing
      const vpGain = after.victoryPoints - preOngoing.victoryPoints;
      const troopGain = after.troopTrack - preOngoing.troopTrack;
      const coinGain = after.coins - preOngoing.coins;
      const citizenGain = after.citizenTrack - preOngoing.citizenTrack;
      if (vpGain > 0) {
        updatedState = appendLogEntry(updatedState, { roundNumber, phase: 'TAXATION', playerId: player.playerId, action: `Gained ${vpGain} VP from card effects`, details: { vpGain } });
      }
      if (troopGain > 0) {
        updatedState = appendLogEntry(updatedState, { roundNumber, phase: 'TAXATION', playerId: player.playerId, action: `Gained ${troopGain} troops from card effects`, details: { troopGain } });
      }
      if (coinGain > 0) {
        updatedState = appendLogEntry(updatedState, { roundNumber, phase: 'TAXATION', playerId: player.playerId, action: `Gained ${coinGain} extra drachma from card effects`, details: { extraCoins: coinGain } });
      }
      if (citizenGain > 0) {
        updatedState = appendLogEntry(updatedState, { roundNumber, phase: 'TAXATION', playerId: player.playerId, action: `Gained ${citizenGain} citizens from card effects`, details: { citizenGain } });
      }
    }

    // Create a display pending decision so the phase pauses for clients to see tax results
    const now = Date.now();
    updatedState = {
      ...updatedState,
      pendingDecisions: [{
        playerId: '__display__',
        decisionType: 'PHASE_DISPLAY' as const,
        timeoutAt: now + 15_000,
        options: null as unknown,
      }],
    };

    return updatedState;
  }

  handleDecision(
    _state: GameState,
    _playerId: string,
    _decision: ClientMessage,
  ): Result<GameState, GameError> {
    return {
      ok: false,
      error: { code: 'WRONG_PHASE', message: 'No decisions during Taxation phase' },
    };
  }

  isComplete(state: GameState): boolean {
    return state.pendingDecisions.length === 0;
  }

  autoResolve(state: GameState, _playerId: string): GameState {
    return { ...state, pendingDecisions: [] };
  }
}
