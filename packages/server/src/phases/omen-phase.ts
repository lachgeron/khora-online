/**
 * OmenPhaseManager — handles the Omen phase (Phase A) of each round.
 *
 * Reveals the top event card from the deck.
 * Exception: The "Growing Populations" event triggers during Phase C (Dice),
 * not during Event Resolution. Its triggerDuringDice flag handles this.
 */

import type { ClientMessage, GameState, Result, GameError } from '@khora/shared';
import { appendLogEntry } from '../game-log';

export interface PhaseManager {
  onEnter(state: GameState): GameState;
  handleDecision(state: GameState, playerId: string, decision: ClientMessage): Result<GameState, GameError>;
  isComplete(state: GameState): boolean;
  autoResolve(state: GameState, playerId: string): GameState;
}

export class OmenPhaseManager implements PhaseManager {
  onEnter(state: GameState): GameState {
    if (state.eventDeck.length === 0) {
      return { ...state, currentEvent: null };
    }

    const [topCard, ...remainingDeck] = state.eventDeck;

    let newState: GameState = {
      ...state,
      currentEvent: topCard,
      eventDeck: remainingDeck,
    };

    // Only reveal the card — effects are applied during Event Resolution (Glory phase)
    newState = appendLogEntry(newState, { roundNumber: state.roundNumber, phase: 'OMEN', playerId: null, action: `Event revealed: ${topCard.name}`, details: { eventId: topCard.id } });

    // Create a display pending decision so the phase pauses for clients to see the event
    const now = Date.now();
    newState = {
      ...newState,
      pendingDecisions: [{
        playerId: '__display__',
        decisionType: 'PHASE_DISPLAY' as const,
        timeoutAt: now + 15_000,
        options: null as unknown,
      }],
    };

    return newState;
  }

  handleDecision(
    _state: GameState,
    _playerId: string,
    _decision: ClientMessage,
  ): Result<GameState, GameError> {
    return {
      ok: false,
      error: { code: 'WRONG_PHASE', message: 'No decisions during Omen phase' },
    };
  }

  isComplete(state: GameState): boolean {
    return state.pendingDecisions.length === 0;
  }

  autoResolve(state: GameState, _playerId: string): GameState {
    return { ...state, pendingDecisions: [] };
  }
}
