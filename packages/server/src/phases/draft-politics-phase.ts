/**
 * DraftPoliticsPhaseManager — handles the politics card drafting sub-phase.
 *
 * Each player receives a pile of 5 cards. They pick one card, then pass
 * the remaining cards to the next player. After 5 rounds of picking,
 * all cards have been drafted.
 */

import type {
  ClientMessage,
  GameState,
  PoliticsCard,
  PoliticsDraftState,
  Result,
  GameError,
} from '@khora/shared';
import type { PhaseManager } from './omen-phase';

const CARDS_PER_PILE = 5;
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

export class DraftPoliticsPhaseManager implements PhaseManager {
  onEnter(state: GameState): GameState {
    const playerIds = state.players.filter(p => !p.hasFlagged).map(p => p.playerId);
    const totalCardsNeeded = playerIds.length * CARDS_PER_PILE;

    // Shuffle and deal from the politics deck
    const shuffledDeck = shuffle([...state.politicsDeck]);
    const dealtCards = shuffledDeck.slice(0, totalCardsNeeded);
    const remainingDeck = shuffledDeck.slice(totalCardsNeeded);

    // Deal piles to each player
    const packs: Record<string, PoliticsCard[]> = {};
    const selectedCards: Record<string, PoliticsCard[]> = {};
    playerIds.forEach((id, i) => {
      packs[id] = dealtCards.slice(i * CARDS_PER_PILE, (i + 1) * CARDS_PER_PILE);
      selectedCards[id] = [];
    });

    const politicsDraft: PoliticsDraftState = {
      packs,
      draftRound: 1,
      selectedCards,
      waitingFor: [...playerIds],
      passOrder: [...playerIds],
    };

    return {
      ...state,
      politicsDeck: remainingDeck,
      draftState: { cityDraft: state.draftState?.cityDraft ?? null, politicsDraft, pickBanDraft: null },
      pendingDecisions: playerIds.map(id => ({
        playerId: id,
        decisionType: 'DRAFT_CARD' as const,
        timeoutAt: Date.now() + 60_000,
        options: {},
      })),
    };
  }

  handleDecision(
    state: GameState,
    playerId: string,
    decision: ClientMessage,
  ): Result<GameState, GameError> {
    if (decision.type !== 'DRAFT_CARD') {
      return {
        ok: false,
        error: { code: 'WRONG_PHASE', message: 'Expected DRAFT_CARD during politics drafting phase.' },
      };
    }

    const draft = state.draftState?.politicsDraft;
    if (!draft) {
      return {
        ok: false,
        error: { code: 'WRONG_PHASE', message: 'No politics draft state.' },
      };
    }

    if (!draft.waitingFor.includes(playerId)) {
      return {
        ok: false,
        error: { code: 'DUPLICATE_ACTION', message: 'You have already picked a card this round.' },
      };
    }

    const pack = draft.packs[playerId];
    if (!pack) {
      return {
        ok: false,
        error: { code: 'INVALID_DECISION', message: 'No pack found for this player.' },
      };
    }

    const cardIndex = pack.findIndex(c => c.id === decision.cardId);
    if (cardIndex === -1) {
      return {
        ok: false,
        error: { code: 'INVALID_DECISION', message: 'That card is not in your current pack.' },
      };
    }

    // Pick the card
    const pickedCard = pack[cardIndex];
    const remainingPack = [...pack.slice(0, cardIndex), ...pack.slice(cardIndex + 1)];

    const newSelectedCards = {
      ...draft.selectedCards,
      [playerId]: [...(draft.selectedCards[playerId] ?? []), pickedCard],
    };

    const newPacks = { ...draft.packs, [playerId]: remainingPack };
    const newWaitingFor = draft.waitingFor.filter(id => id !== playerId);

    let newDraft: PoliticsDraftState = {
      ...draft,
      packs: newPacks,
      selectedCards: newSelectedCards,
      waitingFor: newWaitingFor,
    };

    let pendingDecisions = state.pendingDecisions.filter(d => d.playerId !== playerId);

    // If all players have picked this round, advance to next round
    if (newWaitingFor.length === 0) {
      const nextRound = draft.draftRound + 1;

      if (nextRound <= PICKS_PER_PLAYER) {
        // Pass packs to the next player in order
        const passOrder = draft.passOrder;
        const rotatedPacks: Record<string, PoliticsCard[]> = {};
        for (let i = 0; i < passOrder.length; i++) {
          const fromPlayer = passOrder[i];
          const toPlayer = passOrder[(i + 1) % passOrder.length];
          rotatedPacks[toPlayer] = newPacks[fromPlayer];
        }

        newDraft = {
          ...newDraft,
          packs: rotatedPacks,
          draftRound: nextRound,
          waitingFor: [...passOrder],
        };

        pendingDecisions = passOrder.map(id => ({
          playerId: id,
          decisionType: 'DRAFT_CARD' as const,
          timeoutAt: Date.now() + 60_000,
          options: {},
        }));
      } else {
        // Drafting complete — remaining cards are discarded
        newDraft = { ...newDraft, draftRound: nextRound, waitingFor: [] };
        pendingDecisions = [];
      }
    }

    return {
      ok: true,
      value: {
        ...state,
        draftState: { ...state.draftState!, politicsDraft: newDraft },
        pendingDecisions,
      },
    };
  }

  isComplete(state: GameState): boolean {
    const draft = state.draftState?.politicsDraft;
    if (!draft) return true;
    return draft.draftRound > PICKS_PER_PLAYER && draft.waitingFor.length === 0;
  }

  autoResolve(state: GameState, playerId: string): GameState {
    const draft = state.draftState?.politicsDraft;
    if (!draft) return state;

    const pack = draft.packs[playerId];
    if (!pack || pack.length === 0) return state;

    // Auto-pick the first card
    const result = this.handleDecision(state, playerId, { type: 'DRAFT_CARD', cardId: pack[0].id });
    return result.ok ? result.value : state;
  }
}
