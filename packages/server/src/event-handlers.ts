/**
 * Event card handlers for Khora: Rise of an Empire.
 * 
 * Many events compare troop levels across players and apply
 * different effects to the highest/lowest. This module provides
 * dedicated handlers for each event that needs custom logic.
 */

import type { GameState, PlayerState } from '@khora/shared';

function updatePlayer(state: GameState, playerId: string, fn: (p: PlayerState) => PlayerState): GameState {
  const idx = state.players.findIndex(p => p.playerId === playerId);
  if (idx === -1) return state;
  const players = [...state.players];
  players[idx] = fn(players[idx]);
  return { ...state, players };
}

export function getHighestTroops(state: GameState): PlayerState[] {
  const connected = state.players.filter(p => p.isConnected);
  if (connected.length === 0) return [];
  const max = Math.max(...connected.map(p => p.troopTrack));
  return connected.filter(p => p.troopTrack === max);
}

export function getLowestTroops(state: GameState): PlayerState[] {
  const connected = state.players.filter(p => p.isConnected);
  if (connected.length === 0) return [];
  const min = Math.min(...connected.map(p => p.troopTrack));
  return connected.filter(p => p.troopTrack === min);
}

/**
 * Collects all card IDs currently in any player's hand or played area.
 * Used to guard against state corruption where a card exists in both
 * the deck and a player's hand simultaneously.
 */
function getOwnedCardIds(state: GameState): Set<string> {
  const ids = new Set<string>();
  for (const p of state.players) {
    for (const c of p.handCards) ids.add(c.id);
    for (const c of p.playedCards) ids.add(c.id);
  }
  return ids;
}

/**
 * Apply the full event effect including troop-comparison logic.
 * Called from the omen phase after the event card is revealed.
 */
export function applyEventEffect(state: GameState, eventId: string): GameState {
  const handler = EVENT_HANDLERS[eventId];
  if (handler) return handler(state);
  return state;
}

const EVENT_HANDLERS: Record<string, (state: GameState) => GameState> = {
  // Plague of Athens: All players lose 2 Citizens (handled by immediateEffect)
  // Supplies from Lydia: All players gain 3 Drachma (handled by immediateEffect)
  // Drought: All players lose 2 Drachma (handled by immediateEffect)
  // Invention of the Trireme: All players gain 3 troops (handled by immediateEffect)
  // Outbreak of War: All players lose 2 troops (handled by immediateEffect)

  // Origin of the Academy: Highest troops +1 scroll, lowest troops lose all scrolls
  'origin-of-academy': (s) => {
    let state = s;
    for (const p of getHighestTroops(state)) {
      state = updatePlayer(state, p.playerId, pl => ({ ...pl, philosophyTokens: pl.philosophyTokens + 1 }));
    }
    for (const p of getLowestTroops(state)) {
      state = updatePlayer(state, p.playerId, pl => ({ ...pl, philosophyTokens: 0 }));
    }
    return state;
  },

  // Oracle of Delphi: All players lose 1 token. If you lost one, gain 2 scrolls
  // Handled interactively in the Glory phase — players choose which token to lose
  'oracle-of-delphi': (s) => s,

  // Conscripting Troops: Highest troops +3 citizens, lowest -3 citizens
  'conscripting-troops': (s) => {
    let state = s;
    for (const p of getHighestTroops(state)) {
      state = updatePlayer(state, p.playerId, pl => ({ ...pl, citizenTrack: Math.min(pl.citizenTrack + 3, 15) }));
    }
    for (const p of getLowestTroops(state)) {
      state = updatePlayer(state, p.playerId, pl => ({ ...pl, citizenTrack: Math.max(0, pl.citizenTrack - 3) }));
    }
    return state;
  },

  // Eleusinian Mysteries: Highest troops +4 VP, lowest -4 VP
  'eleusinian-mysteries': (s) => {
    let state = s;
    for (const p of getHighestTroops(state)) {
      state = updatePlayer(state, p.playerId, pl => ({ ...pl, victoryPoints: pl.victoryPoints + 4 }));
    }
    for (const p of getLowestTroops(state)) {
      state = updatePlayer(state, p.playerId, pl => ({ ...pl, victoryPoints: Math.max(0, pl.victoryPoints - 4) }));
    }
    return state;
  },

  // Military Victory: Highest troops choose a track to progress at -2 drachma discount
  // Handled interactively in the Glory phase
  'military-victory': (s) => s,

  // Prosperity: Highest troops takes 1 politics action
  // Handled interactively in the Glory phase — no auto-resolve here
  'prosperity': (s) => s,

  // The Savior of Greece: Highest troops +2 Drachma, lowest -2 Drachma
  'savior-of-greece': (s) => {
    let state = s;
    for (const p of getHighestTroops(state)) {
      state = updatePlayer(state, p.playerId, pl => ({ ...pl, coins: pl.coins + 2 }));
    }
    for (const p of getLowestTroops(state)) {
      state = updatePlayer(state, p.playerId, pl => ({ ...pl, coins: Math.max(0, pl.coins - 2) }));
    }
    return state;
  },

  // The Rise of Persia: All players may pay discounted drachma to progress military
  // Handled interactively in the Glory phase
  'rise-of-persia': (s) => s,

  // The Thirty Tyrants: Highest troops draw 2 cards, lowest choose 2 cards to discard
  // Draw is auto, discard is interactive in the Glory phase
  'thirty-tyrants': (s) => {
    let state = s;
    for (const p of getHighestTroops(state)) {
      const owned = getOwnedCardIds(state);
      const candidates = state.politicsDeck.filter(c => !owned.has(c.id));
      const drawn = candidates.slice(0, 2);
      // Remove ALL drawn cards from the deck (they may not be contiguous
      // after filtering, so remove by ID rather than slicing from the top)
      const drawnIds = new Set(drawn.map(c => c.id));
      state = { ...state, politicsDeck: state.politicsDeck.filter(c => !drawnIds.has(c.id)) };
      if (drawn.length > 0) {
        state = updatePlayer(state, p.playerId, pl => ({ ...pl, handCards: [...pl.handCards, ...drawn] }));
      }
    }
    // Discard for lowest troops is handled interactively in Glory phase
    return state;
  },
};
