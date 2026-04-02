/**
 * CitySelectionPhaseManager — handles the city-picking sub-phase.
 *
 * Players pick cities in a randomized order. Each player is offered 3
 * random cities from the remaining pool and must choose one.
 */

import type {
  ClientMessage,
  GameState,
  CityCard,
  CityDraftState,
  Result,
  GameError,
} from '@khora/shared';
import type { PhaseManager } from './omen-phase';

/**
 * Fisher-Yates shuffle (returns new array).
 */
function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Offers 3 random cities from the remaining pool to the current picker.
 */
function offerCitiesToCurrentPicker(draft: CityDraftState): CityDraftState {
  const currentPlayerId = draft.pickOrder[draft.currentPickerIndex];
  if (!currentPlayerId || draft.remainingPool.length === 0) return draft;

  const shuffledPool = shuffle(draft.remainingPool);
  const offered = shuffledPool.slice(0, Math.min(3, shuffledPool.length));
  const offeredIds = offered.map(c => c.id);

  return {
    ...draft,
    offeredCities: { ...draft.offeredCities, [currentPlayerId]: offeredIds },
  };
}

export class CitySelectionPhaseManager implements PhaseManager {
  onEnter(state: GameState): GameState {
    const playerIds = state.players.map(p => p.playerId);
    const pickOrder = shuffle(playerIds);

    // All cities are in the pool initially
    const allCities = state.draftState?.cityDraft?.allCities ?? [];

    let cityDraft: CityDraftState = {
      pickOrder,
      currentPickerIndex: 0,
      offeredCities: {},
      remainingPool: [...allCities],
      selections: {},
      allCities,
    };

    // Offer cities to the first picker
    cityDraft = offerCitiesToCurrentPicker(cityDraft);

    const pendingPlayerId = pickOrder[0];

    return {
      ...state,
      draftState: { ...state.draftState, cityDraft, politicsDraft: null },
      pendingDecisions: pendingPlayerId
        ? [{
            playerId: pendingPlayerId,
            decisionType: 'SELECT_CITY',
            timeoutAt: Date.now() + 60_000,
            options: {},
          }]
        : [],
    };
  }

  handleDecision(
    state: GameState,
    playerId: string,
    decision: ClientMessage,
  ): Result<GameState, GameError> {
    if (decision.type !== 'SELECT_CITY') {
      return {
        ok: false,
        error: { code: 'WRONG_PHASE', message: 'Expected SELECT_CITY during city selection phase.' },
      };
    }

    const draft = state.draftState?.cityDraft;
    if (!draft) {
      return {
        ok: false,
        error: { code: 'WRONG_PHASE', message: 'No city draft state.' },
      };
    }

    const currentPickerId = draft.pickOrder[draft.currentPickerIndex];
    if (playerId !== currentPickerId) {
      return {
        ok: false,
        error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn to pick a city.' },
      };
    }

    const offeredIds = draft.offeredCities[playerId] ?? [];
    if (!offeredIds.includes(decision.cityId)) {
      return {
        ok: false,
        error: { code: 'INVALID_DECISION', message: 'That city was not offered to you.' },
      };
    }

    // Record selection
    const newSelections = { ...draft.selections, [playerId]: decision.cityId };

    // Remove only the chosen city from the pool (unchosen offered cities stay available)
    const newPool = draft.remainingPool.filter(c => c.id !== decision.cityId);

    let newDraft: CityDraftState = {
      ...draft,
      selections: newSelections,
      remainingPool: newPool,
      currentPickerIndex: draft.currentPickerIndex + 1,
    };

    // Offer cities to the next picker if there is one
    let pendingDecisions = state.pendingDecisions;
    if (newDraft.currentPickerIndex < draft.pickOrder.length) {
      newDraft = offerCitiesToCurrentPicker(newDraft);
      const nextPlayerId = draft.pickOrder[newDraft.currentPickerIndex];
      pendingDecisions = [{
        playerId: nextPlayerId,
        decisionType: 'SELECT_CITY',
        timeoutAt: Date.now() + 60_000,
        options: {},
      }];
    } else {
      pendingDecisions = [];
    }

    return {
      ok: true,
      value: {
        ...state,
        draftState: { ...state.draftState!, cityDraft: newDraft, politicsDraft: null },
        pendingDecisions,
      },
    };
  }

  isComplete(state: GameState): boolean {
    const draft = state.draftState?.cityDraft;
    if (!draft) return true;
    return draft.currentPickerIndex >= draft.pickOrder.length;
  }

  autoResolve(state: GameState, playerId: string): GameState {
    const draft = state.draftState?.cityDraft;
    if (!draft) return state;

    const offeredIds = draft.offeredCities[playerId] ?? [];
    if (offeredIds.length === 0) return state;

    // Auto-pick the first offered city
    const autoCity = offeredIds[0];
    const result = this.handleDecision(state, playerId, { type: 'SELECT_CITY', cityId: autoCity });
    return result.ok ? result.value : state;
  }
}
