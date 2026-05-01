/**
 * PickBanDraftPhaseManager — handles the pick/ban politics card drafting sub-phase.
 *
 * All politics cards are displayed to all players. Players take turns in a
 * randomized order:
 * 1. BAN phase: each player bans 1 card at a time until each has banned 2 cards.
 * 2. PICK phase: each player picks 1 card at a time until each has 5 cards.
 *
 * No player can pick or ban twice in a row — turns cycle in a fixed random order.
 */

import type {
  ClientMessage,
  GameState,
  PoliticsCard,
  PickBanDraftState,
  Result,
  GameError,
} from '@khora/shared';
import type { PhaseManager } from './omen-phase';

const BANS_PER_PLAYER = 2;
const PICKS_PER_PLAYER = 5;

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

export class PickBanDraftPhaseManager implements PhaseManager {
  onEnter(state: GameState): GameState {
    const playerIds = state.players.filter(p => !p.hasFlagged).map(p => p.playerId);
    const turnOrder = shuffle(playerIds);

    // Use all politics cards for the pick/ban pool
    const allCards = shuffle([...state.politicsDeck]);

    const bannedCards: Record<string, PoliticsCard[]> = {};
    const pickedCards: Record<string, PoliticsCard[]> = {};
    for (const id of playerIds) {
      bannedCards[id] = [];
      pickedCards[id] = [];
    }

    const pickBanDraft: PickBanDraftState = {
      allCards,
      bannedCards,
      pickedCards,
      turnOrder,
      currentTurnIndex: 0,
      phase: 'BAN',
      bansPerPlayer: BANS_PER_PLAYER,
      picksPerPlayer: PICKS_PER_PLAYER,
    };

    const currentPlayerId = turnOrder[0];

    return {
      ...state,
      draftState: {
        cityDraft: state.draftState?.cityDraft ?? null,
        politicsDraft: null,
        pickBanDraft,
      },
      pendingDecisions: [{
        playerId: currentPlayerId,
        decisionType: 'PICK_BAN_CARD' as const,
        timeoutAt: Date.now() + 60_000,
        options: { action: 'BAN' },
      }],
    };
  }

  handleDecision(
    state: GameState,
    playerId: string,
    decision: ClientMessage,
  ): Result<GameState, GameError> {
    if (decision.type !== 'PICK_BAN_CARD') {
      return {
        ok: false,
        error: { code: 'WRONG_PHASE', message: 'Expected PICK_BAN_CARD during pick/ban drafting phase.' },
      };
    }

    const draft = state.draftState?.pickBanDraft;
    if (!draft) {
      return {
        ok: false,
        error: { code: 'WRONG_PHASE', message: 'No pick/ban draft state.' },
      };
    }

    // Verify it's this player's turn
    const expectedPlayer = draft.turnOrder[draft.currentTurnIndex];
    if (playerId !== expectedPlayer) {
      return {
        ok: false,
        error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn.' },
      };
    }

    // Verify action matches current phase
    if (decision.action !== draft.phase) {
      return {
        ok: false,
        error: { code: 'INVALID_DECISION', message: `Expected ${draft.phase} action, got ${decision.action}.` },
      };
    }

    // Find the card — must be in allCards and not already banned or picked
    const allBannedIds = new Set(Object.values(draft.bannedCards).flatMap(cards => cards.map(c => c.id)));
    const allPickedIds = new Set(Object.values(draft.pickedCards).flatMap(cards => cards.map(c => c.id)));
    const card = draft.allCards.find(c => c.id === decision.cardId);

    if (!card) {
      return {
        ok: false,
        error: { code: 'INVALID_DECISION', message: 'Card not found in pool.' },
      };
    }

    if (allBannedIds.has(decision.cardId) || allPickedIds.has(decision.cardId)) {
      return {
        ok: false,
        error: { code: 'INVALID_DECISION', message: 'That card has already been banned or picked.' },
      };
    }

    // Apply the action
    let newDraft: PickBanDraftState;
    if (decision.action === 'BAN') {
      newDraft = {
        ...draft,
        bannedCards: {
          ...draft.bannedCards,
          [playerId]: [...draft.bannedCards[playerId], card],
        },
      };
    } else {
      newDraft = {
        ...draft,
        pickedCards: {
          ...draft.pickedCards,
          [playerId]: [...draft.pickedCards[playerId], card],
        },
      };
    }

    // Advance to next turn
    newDraft = this.advanceTurn(newDraft);

    return {
      ok: true,
      value: {
        ...state,
        draftState: { ...state.draftState!, pickBanDraft: newDraft },
        pendingDecisions: this.isPickBanComplete(newDraft) ? [] : [{
          playerId: newDraft.turnOrder[newDraft.currentTurnIndex],
          decisionType: 'PICK_BAN_CARD' as const,
          timeoutAt: Date.now() + 60_000,
          options: { action: newDraft.phase },
        }],
      },
    };
  }

  private advanceTurn(draft: PickBanDraftState): PickBanDraftState {
    const playerCount = draft.turnOrder.length;
    let nextIndex = (draft.currentTurnIndex + 1) % playerCount;

    // Check if we need to transition from BAN to PICK phase
    if (draft.phase === 'BAN') {
      const allBansDone = draft.turnOrder.every(
        pid => draft.bannedCards[pid].length >= draft.bansPerPlayer,
      );
      if (allBansDone) {
        return {
          ...draft,
          phase: 'PICK',
          currentTurnIndex: nextIndex,
        };
      }
    }

    return {
      ...draft,
      currentTurnIndex: nextIndex,
    };
  }

  private isPickBanComplete(draft: PickBanDraftState): boolean {
    if (draft.phase === 'BAN') return false;
    return draft.turnOrder.every(
      pid => draft.pickedCards[pid].length >= draft.picksPerPlayer,
    );
  }

  isComplete(state: GameState): boolean {
    const draft = state.draftState?.pickBanDraft;
    if (!draft) return true;
    return this.isPickBanComplete(draft);
  }

  autoResolve(state: GameState, playerId: string): GameState {
    const draft = state.draftState?.pickBanDraft;
    if (!draft) return state;

    // Pick a random available card
    const allBannedIds = new Set(Object.values(draft.bannedCards).flatMap(cards => cards.map(c => c.id)));
    const allPickedIds = new Set(Object.values(draft.pickedCards).flatMap(cards => cards.map(c => c.id)));
    const available = draft.allCards.filter(c => !allBannedIds.has(c.id) && !allPickedIds.has(c.id));

    if (available.length === 0) return state;

    const randomCard = available[Math.floor(Math.random() * available.length)];
    const result = this.handleDecision(state, playerId, {
      type: 'PICK_BAN_CARD',
      cardId: randomCard.id,
      action: draft.phase,
    });

    return result.ok ? result.value : state;
  }
}
