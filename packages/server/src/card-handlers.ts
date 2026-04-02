/**
 * Card effect handlers for Khora: Rise of an Empire.
 *
 * Each ONGOING card has a trigger condition and an effect that modifies game state.
 * IMMEDIATE cards apply their effect once when played.
 * END_GAME cards have scoring functions evaluated at final scoring.
 *
 * Trigger points:
 * - ON_ACTION(actionType): when a player takes a specific action
 * - ON_PLAY_CARD: when a player plays any politics card (excluding the triggering card itself for some)
 * - ON_TAX_PHASE: during the taxation phase
 * - ON_PROGRESS_PHASE: during the progress phase
 * - ON_EXPLORE: when exploring a knowledge token
 */

import type { GameState, PlayerState, ActionType, PoliticsCard } from '@khora/shared';
import { createMinorToken } from './knowledge-tokens';
import { applyEffectToPlayer } from './effects';

// ─── ONGOING CARD TRIGGERS ───────────────────────────────────────────────────

export type OngoingTrigger =
  | { type: 'ON_ACTION'; actionType: ActionType }
  | { type: 'ON_PLAY_CARD' }
  | { type: 'ON_TAX_PHASE' }
  | { type: 'ON_PROGRESS_PHASE' }
  | { type: 'ON_EXPLORE' }
  | { type: 'ON_PHILOSOPHY_ACTION' }
  | { type: 'ON_DEVELOPMENT_ACTION' };

export interface OngoingCardHandler {
  cardId: string;
  trigger: OngoingTrigger;
  apply: (state: GameState, playerId: string) => GameState;
}

function updatePlayer(state: GameState, playerId: string, fn: (p: PlayerState) => PlayerState): GameState {
  const idx = state.players.findIndex(p => p.playerId === playerId);
  if (idx === -1) return state;
  const players = [...state.players];
  players[idx] = fn(players[idx]);
  return { ...state, players };
}

export const ONGOING_HANDLERS: OngoingCardHandler[] = [
  // Stoa Poikile: +2 Drachma on culture action
  { cardId: 'stoa-poikile', trigger: { type: 'ON_ACTION', actionType: 'CULTURE' },
    apply: (s, pid) => updatePlayer(s, pid, p => ({ ...p, coins: p.coins + 2 })) },

  // Amnesty for Socrates: +1 scroll on legislation action
  { cardId: 'amnesty-for-socrates', trigger: { type: 'ON_ACTION', actionType: 'LEGISLATION' },
    apply: (s, pid) => updatePlayer(s, pid, p => ({ ...p, philosophyTokens: p.philosophyTokens + 1 })) },

  // Persians: +2 troops on culture action
  { cardId: 'persians', trigger: { type: 'ON_ACTION', actionType: 'CULTURE' },
    apply: (s, pid) => updatePlayer(s, pid, p => ({ ...p, troopTrack: p.troopTrack + 2 })) },

  // Extraordinary Collection: +2 Drachma when you play a card (excluding this one)
  { cardId: 'extraordinary-collection', trigger: { type: 'ON_PLAY_CARD' },
    apply: (s, pid) => updatePlayer(s, pid, p => ({ ...p, coins: p.coins + 2 })) },

  // Diolkos: +1 Drachma, +1 troop, +1 VP on trade action
  { cardId: 'diolkos', trigger: { type: 'ON_ACTION', actionType: 'TRADE' },
    apply: (s, pid) => updatePlayer(s, pid, p => ({
      ...p, coins: p.coins + 1, troopTrack: p.troopTrack + 1, victoryPoints: p.victoryPoints + 1,
    })) },

  // Corinthian Columns: minor knowledge cost reduced from 5 to 3 on trade
  // This is handled as a modifier in the trade resolver, not as a state change here.
  // We register it so the trade resolver can check for it.
  { cardId: 'corinthian-columns', trigger: { type: 'ON_ACTION', actionType: 'TRADE' },
    apply: (s, _pid) => s }, // No-op; trade resolver checks for this card

  // Foreign Supplies: +2 troops on trade action
  { cardId: 'foreign-supplies', trigger: { type: 'ON_ACTION', actionType: 'TRADE' },
    apply: (s, pid) => updatePlayer(s, pid, p => ({ ...p, troopTrack: p.troopTrack + 2 })) },

  // Gradualism: pay 1 less Drachma on progress — handled as modifier in progress phase
  { cardId: 'gradualism', trigger: { type: 'ON_PROGRESS_PHASE' },
    apply: (s, _pid) => s }, // Modifier checked by progress phase

  // Old Guard: +4 VP if you don't move up on any track during progress phase
  { cardId: 'old-guard', trigger: { type: 'ON_PROGRESS_PHASE' },
    apply: (s, pid) => updatePlayer(s, pid, p => ({ ...p, victoryPoints: p.victoryPoints + 4 })) },

  // Oracle: +4 VP on development action
  { cardId: 'oracle', trigger: { type: 'ON_ACTION', actionType: 'DEVELOPMENT' },
    apply: (s, pid) => updatePlayer(s, pid, p => ({ ...p, victoryPoints: p.victoryPoints + 4 })) },

  // Power: +4 VP during tax if no other player has lower culture track
  { cardId: 'power', trigger: { type: 'ON_TAX_PHASE' },
    apply: (s, pid) => {
      const player = s.players.find(p => p.playerId === pid);
      if (!player) return s;
      const othersLower = s.players.some(p => p.playerId !== pid && p.isConnected && p.cultureTrack < player.cultureTrack);
      if (othersLower) return s;
      return updatePlayer(s, pid, p => ({ ...p, victoryPoints: p.victoryPoints + 4 }));
    } },

  // Public Market: +3 VP during tax if no other player has higher economy track
  { cardId: 'public-market', trigger: { type: 'ON_TAX_PHASE' },
    apply: (s, pid) => {
      const player = s.players.find(p => p.playerId === pid);
      if (!player) return s;
      const othersHigher = s.players.some(p => p.playerId !== pid && p.isConnected && p.economyTrack > player.economyTrack);
      if (othersHigher) return s;
      return updatePlayer(s, pid, p => ({ ...p, victoryPoints: p.victoryPoints + 3 }));
    } },

  // Reformists: may move up 2 total levels during progress — handled as modifier
  { cardId: 'reformists', trigger: { type: 'ON_PROGRESS_PHASE' },
    apply: (s, _pid) => s }, // Modifier checked by progress phase

  // Founding the Lyceum: +1 scroll on philosophy action
  { cardId: 'founding-the-lyceum', trigger: { type: 'ON_ACTION', actionType: 'PHILOSOPHY' },
    apply: (s, pid) => updatePlayer(s, pid, p => ({ ...p, philosophyTokens: p.philosophyTokens + 1 })) },

  // Stadion: +2 troops during tax phase
  { cardId: 'stadion', trigger: { type: 'ON_TAX_PHASE' },
    apply: (s, pid) => updatePlayer(s, pid, p => ({ ...p, troopTrack: p.troopTrack + 2 })) },

  // Lighthouse: +3 VP on trade action
  { cardId: 'lighthouse', trigger: { type: 'ON_ACTION', actionType: 'TRADE' },
    apply: (s, pid) => updatePlayer(s, pid, p => ({ ...p, victoryPoints: p.victoryPoints + 3 })) },

  // Helepole: spend 1 less troop when exploring — handled as modifier in explore
  { cardId: 'helepole', trigger: { type: 'ON_EXPLORE' },
    apply: (s, _pid) => s }, // Modifier checked by explore function

  // Constructing the Mint: economy progress is free — handled as modifier
  { cardId: 'constructing-the-mint', trigger: { type: 'ON_PROGRESS_PHASE' },
    apply: (s, _pid) => s }, // Modifier checked by progress phase
];

// ─── TRIGGER HELPERS ─────────────────────────────────────────────────────────

/** Returns true if a player has a specific card in play. */
export function hasCardInPlay(player: PlayerState, cardId: string): boolean {
  return player.playedCards.some(c => c.id === cardId);
}

/** Apply all ongoing card effects for a given trigger to a player. */
export function applyOngoingEffects(
  state: GameState,
  playerId: string,
  trigger: OngoingTrigger,
  excludeCardId?: string,
): GameState {
  const player = state.players.find(p => p.playerId === playerId);
  if (!player) return state;

  let result = state;
  for (const handler of ONGOING_HANDLERS) {
    if (excludeCardId && handler.cardId === excludeCardId) continue;
    if (!hasCardInPlay(player, handler.cardId)) continue;
    if (!matchesTrigger(handler.trigger, trigger)) continue;
    result = handler.apply(result, playerId);
  }
  return result;
}

function matchesTrigger(handler: OngoingTrigger, trigger: OngoingTrigger): boolean {
  if (handler.type !== trigger.type) return false;
  if (handler.type === 'ON_ACTION' && trigger.type === 'ON_ACTION') {
    return handler.actionType === trigger.actionType;
  }
  return true;
}

/** Apply all ongoing tax-phase effects for all players. */
export function applyAllTaxPhaseOngoing(state: GameState): GameState {
  let result = state;
  for (const player of state.players) {
    if (!player.isConnected) continue;
    result = applyOngoingEffects(result, player.playerId, { type: 'ON_TAX_PHASE' });
  }
  return result;
}

// ─── IMMEDIATE CARD EFFECTS ──────────────────────────────────────────────────

/**
 * Apply the immediate effect of a card when it is played.
 * Some cards have complex effects beyond the simple GameEffect system.
 */
export function applyImmediateCardEffect(
  state: GameState,
  playerId: string,
  cardId: string,
): GameState {
  const handler = IMMEDIATE_HANDLERS[cardId];
  if (handler) {
    return handler(state, playerId);
  }
  // Fallback: apply the card's effect field directly
  const player = state.players.find(p => p.playerId === playerId);
  if (!player) return state;
  const card = player.playedCards.find(c => c.id === cardId);
  if (card) {
    return updatePlayer(state, playerId, p => applyEffectToPlayer(p, card.effect));
  }
  return state;
}

const IMMEDIATE_HANDLERS: Record<string, (state: GameState, playerId: string) => GameState> = {
  // Gifts from the West: gain 3 Drachma
  'gifts-from-the-west': (s, pid) => updatePlayer(s, pid, p => ({ ...p, coins: p.coins + 3 })),

  // Archives: gain 3 scrolls
  'archives': (s, pid) => updatePlayer(s, pid, p => ({ ...p, philosophyTokens: p.philosophyTokens + 3 })),

  // Tunnel of Eupalinos: gain 6 VP
  'tunnel-of-eupalinos': (s, pid) => updatePlayer(s, pid, p => ({ ...p, victoryPoints: p.victoryPoints + 6 })),

  // Colossus of Rhodes: gain 10 VP
  'colossus-of-rhodes': (s, pid) => updatePlayer(s, pid, p => ({ ...p, victoryPoints: p.victoryPoints + 10 })),

  // Quarry: gain 1 taxes
  'quarry': (s, pid) => updatePlayer(s, pid, p => ({ ...p, taxTrack: p.taxTrack + 1 })),

  // Silver Mining: gain 2 taxes
  'silver-mining': (s, pid) => updatePlayer(s, pid, p => ({ ...p, taxTrack: p.taxTrack + 2 })),

  // Peripteros: move up 1 culture for free
  'peripteros': (s, pid) => updatePlayer(s, pid, p => ({ ...p, cultureTrack: p.cultureTrack + 1 })),

  // Greek Fire: gain 4 troops
  'greek-fire': (s, pid) => updatePlayer(s, pid, p => ({ ...p, troopTrack: p.troopTrack + 4 })),

  // Contribution: gain 1 Drachma per minor token
  'contribution': (s, pid) => updatePlayer(s, pid, p => {
    const minorCount = p.knowledgeTokens.filter(t => t.tokenType === 'MINOR').length;
    return { ...p, coins: p.coins + minorCount };
  }),

  // Mercenary Recruitment: gain troops equal to economy track level
  'mercenary-recruitment': (s, pid) => updatePlayer(s, pid, p => ({
    ...p, troopTrack: p.troopTrack + p.economyTrack,
  })),

  // Rivalry: if all others have higher military, move up 1 military for free
  'rivalry': (s, pid) => {
    const player = s.players.find(p => p.playerId === pid);
    if (!player) return s;
    const allOthersHigher = s.players
      .filter(p => p.playerId !== pid && p.isConnected)
      .every(p => p.militaryTrack > player.militaryTrack);
    if (!allOthersHigher) return s;
    return updatePlayer(s, pid, p => ({ ...p, militaryTrack: p.militaryTrack + 1 }));
  },

  // Council: draw 2 cards from the deck
  'council': (s, pid) => {
    if (s.politicsDeck.length === 0) return s;
    const drawn = s.politicsDeck.slice(0, 2);
    const remainingDeck = s.politicsDeck.slice(2);
    return {
      ...updatePlayer(s, pid, p => ({ ...p, handCards: [...p.handCards, ...drawn] })),
      politicsDeck: remainingDeck,
    };
  },

  // Scholarly Welcome: gain 1 minor token of your choice from supply
  // For now, defaults to GREEN minor (player choice would need UI support)
  'scholarly-welcome': (s, pid) => {
    const token = createMinorToken('GREEN');
    return updatePlayer(s, pid, p => ({ ...p, knowledgeTokens: [...p.knowledgeTokens, token] }));
  },

  // Ostracism: return 1 played card to hand, then take 1 politics action
  // Complex: for now, just returns the most recently played card to hand
  'ostracism': (s, pid) => updatePlayer(s, pid, p => {
    if (p.playedCards.length <= 1) return p; // Don't return ostracism itself
    // Return the last non-ostracism played card
    const candidates = p.playedCards.filter(c => c.id !== 'ostracism');
    if (candidates.length === 0) return p;
    const returned = candidates[candidates.length - 1];
    return {
      ...p,
      playedCards: p.playedCards.filter(c => c !== returned),
      handCards: [...p.handCards, returned],
    };
  }),
};
