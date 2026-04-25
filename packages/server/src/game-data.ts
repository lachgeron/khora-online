/**
 * Game data for Khora: Rise of an Empire — Base Game.
 * Cards, events, and city states from the official board game.
 */

import type { PoliticsCard, EventCard, CityCard } from '@khora/shared';

// ─── POLITICS CARDS ──────────────────────────────────────────────────────────

export const ALL_POLITICS_CARDS: PoliticsCard[] = [
  // ── END_GAME cards ──
  { id: 'bank', name: 'Bank', description: 'At the end of the game, gain 1 VP for every 2 Drachma', cost: 0, knowledgeRequirement: { green: 0, blue: 0, red: 2 }, type: 'END_GAME',
    effect: { type: 'GAIN_VP', amount: 0 },
    endGameScoring: { type: 'CUSTOM', calculate: (p) => Math.floor(p.coins / 2), description: 'Gain 1 VP for every 2 Drachma' } },
  { id: 'austerity', name: 'Austerity', description: 'At the end of the game, gain 3 VP for each card still in your hand', cost: 6, knowledgeRequirement: { green: 3, blue: 0, red: 0 }, type: 'END_GAME',
    effect: { type: 'GAIN_VP', amount: 0 },
    endGameScoring: { type: 'PER_CARD', calculate: (p) => p.handCards.length * 3, description: 'Gain 3 VP for each card still in your hand' } },
  { id: 'proskenion', name: 'Proskenion', description: 'At the end of the game, gain VP equal to your citizen track level', cost: 0, knowledgeRequirement: { green: 0, blue: 2, red: 0 }, type: 'END_GAME',
    effect: { type: 'GAIN_VP', amount: 0 },
    endGameScoring: { type: 'PER_TRACK_LEVEL', calculate: (p) => p.citizenTrack, description: 'Gain VP equal to your citizen track level' } },
  { id: 'diversification', name: 'Diversification', description: 'At the end of the game, gain VP equal to 3 times your lowest Economy, Culture, and Military track', cost: 6, knowledgeRequirement: { green: 1, blue: 1, red: 1 }, type: 'END_GAME',
    effect: { type: 'GAIN_VP', amount: 0 },
    endGameScoring: { type: 'CUSTOM', calculate: (p) => 3 * Math.min(p.economyTrack, p.cultureTrack, p.militaryTrack), description: 'Gain VP equal to 3× your lowest Economy, Culture, Military track' } },
  { id: 'central-government', name: 'Central Government', description: 'At the end of the game, gain 2 VP for each card you have in play (including this one)', cost: 4, knowledgeRequirement: { green: 2, blue: 0, red: 0 }, type: 'END_GAME',
    effect: { type: 'GAIN_VP', amount: 0 },
    endGameScoring: { type: 'PER_CARD', calculate: (p) => (p.playedCards.length + 1) * 2, description: 'Gain 2 VP for each card in play (including this one)' } },
  { id: 'gold-reserve', name: 'Gold Reserve', description: 'At the end of the game, gain VP equal to double your economy level', cost: 8, knowledgeRequirement: { green: 0, blue: 0, red: 3 }, type: 'END_GAME',
    effect: { type: 'GAIN_VP', amount: 0 },
    endGameScoring: { type: 'PER_TRACK_LEVEL', calculate: (p) => p.economyTrack * 2, description: 'Gain VP equal to double your economy level' } },
  { id: 'heavy-taxes', name: 'Heavy Taxes', description: 'At the end of the game, gain VP equal to double your taxes level', cost: 4, knowledgeRequirement: { green: 2, blue: 0, red: 2 }, type: 'END_GAME',
    effect: { type: 'GAIN_VP', amount: 0 },
    endGameScoring: { type: 'PER_TRACK_LEVEL', calculate: (p) => p.taxTrack * 2, description: 'Gain VP equal to double your taxes level' } },
  { id: 'hall-of-statues', name: 'Hall of Statues', description: 'At the end of the game, gain 1 VP for each major and minor token you have', cost: 2, knowledgeRequirement: { green: 1, blue: 1, red: 1 }, type: 'END_GAME',
    effect: { type: 'GAIN_VP', amount: 0 },
    endGameScoring: { type: 'PER_RESOURCE', calculate: (p) => p.knowledgeTokens.length, description: 'Gain 1 VP for each knowledge token you have' } },

  // ── ONGOING cards ──
  { id: 'stoa-poikile', name: 'Stoa Poikile', description: 'Gain 2 Drachma when you take a culture action', cost: 0, knowledgeRequirement: { green: 1, blue: 0, red: 0 }, type: 'ONGOING',
    effect: { type: 'GAIN_COINS', amount: 2 }, endGameScoring: null }, // +2 drachma on culture action
  { id: 'amnesty-for-socrates', name: 'Amnesty for Socrates', description: 'Gain 1 scroll when you take a legislation action', cost: 2, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'ONGOING',
    effect: { type: 'GAIN_PHILOSOPHY_TOKENS', amount: 1 }, endGameScoring: null }, // +1 scroll on legislation
  { id: 'persians', name: 'Persians', description: 'Gain 2 troops when you take a Culture Action', cost: 0, knowledgeRequirement: { green: 1, blue: 1, red: 0 }, type: 'ONGOING',
    effect: { type: 'ADVANCE_TRACK', track: 'TROOP', amount: 2 }, endGameScoring: null }, // +2 troops on culture
  { id: 'extraordinary-collection', name: 'Extraordinary Collection', description: 'Gain 2 Drachma when you play a card (excluding this one)', cost: 0, knowledgeRequirement: { green: 0, blue: 0, red: 1 }, type: 'ONGOING',
    effect: { type: 'GAIN_COINS', amount: 2 }, endGameScoring: null }, // +2 drachma when playing a card
  { id: 'diolkos', name: 'Diolkos', description: 'Gain an additional 1 Drachma, 1 troop, 1 VP when you take a trade action', cost: 0, knowledgeRequirement: { green: 0, blue: 0, red: 1 }, type: 'ONGOING',
    effect: { type: 'COMPOSITE', effects: [{ type: 'GAIN_COINS', amount: 1 }, { type: 'ADVANCE_TRACK', track: 'TROOP', amount: 1 }, { type: 'GAIN_VP', amount: 1 }] }, endGameScoring: null },
  { id: 'corinthian-columns', name: 'Corinthian Columns', description: 'The cost of a minor is reduced from 5 to 3 when you take a Trade Action', cost: 0, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'ONGOING',
    effect: { type: 'GAIN_COINS', amount: 0 }, endGameScoring: null }, // Minor cost reduced from 5 to 3
  { id: 'foreign-supplies', name: 'Foreign Supplies', description: 'Gain 2 troops when you take a trade action', cost: 2, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'ONGOING',
    effect: { type: 'ADVANCE_TRACK', track: 'TROOP', amount: 2 }, endGameScoring: null }, // +2 troops on trade
  { id: 'gradualism', name: 'Gradualism', description: 'Pay 1 less Drachma when you move up on Economy, Culture or Military', cost: 0, knowledgeRequirement: { green: 1, blue: 0, red: 0 }, type: 'ONGOING',
    effect: { type: 'GAIN_COINS', amount: 0 }, endGameScoring: null }, // Pay 1 less drachma on progress
  { id: 'old-guard', name: 'Old Guard', description: 'Gain 4 VP if you don\'t move up on any track during the progress phase', cost: 0, knowledgeRequirement: { green: 1, blue: 0, red: 1 }, type: 'ONGOING',
    effect: { type: 'GAIN_VP', amount: 4 }, endGameScoring: null }, // +4 VP if no progress this round
  { id: 'oracle', name: 'Oracle', description: 'Gain 4 VP when you take a development action', cost: 3, knowledgeRequirement: { green: 1, blue: 1, red: 1 }, type: 'ONGOING',
    effect: { type: 'GAIN_VP', amount: 4 }, endGameScoring: null }, // +4 VP on development action
  { id: 'power', name: 'Power', description: 'During the Tax Phase, gain 4 VP if no other players have a lower Culture Track level than you', cost: 0, knowledgeRequirement: { green: 0, blue: 1, red: 1 }, type: 'ONGOING',
    effect: { type: 'GAIN_VP', amount: 4 }, endGameScoring: null }, // +4 VP during tax if lowest culture
  { id: 'public-market', name: 'Public Market', description: 'During the Tax Phase, gain 3 VP if no other players have an Economy Track level higher than yours', cost: 3, knowledgeRequirement: { green: 0, blue: 0, red: 1 }, type: 'ONGOING',
    effect: { type: 'GAIN_VP', amount: 3 }, endGameScoring: null }, // +3 VP during tax if highest economy
  { id: 'reformists', name: 'Reformists', description: 'During the Progress Phase, you may move up a total of 2 levels on the Track(s) of your choice', cost: 0, knowledgeRequirement: { green: 1, blue: 1, red: 1 }, type: 'ONGOING',
    effect: { type: 'GAIN_VP', amount: 0 }, endGameScoring: null }, // May move up 2 total levels during progress
  { id: 'founding-the-lyceum', name: 'Founding the Lyceum', description: 'Gain 1 additional Scroll when you take a Philosophy action', cost: 3, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'ONGOING',
    effect: { type: 'GAIN_PHILOSOPHY_TOKENS', amount: 1 }, endGameScoring: null }, // +1 scroll on philosophy
  { id: 'stadion', name: 'Stadion', description: 'Gain 2 troops during the tax phase', cost: 2, knowledgeRequirement: { green: 0, blue: 2, red: 0 }, type: 'ONGOING',
    effect: { type: 'ADVANCE_TRACK', track: 'TROOP', amount: 2 }, endGameScoring: null }, // +2 troops during tax
  { id: 'lighthouse', name: 'Lighthouse', description: 'Gain 3 VP when you take a trade action', cost: 1, knowledgeRequirement: { green: 0, blue: 0, red: 1 }, type: 'ONGOING',
    effect: { type: 'GAIN_VP', amount: 3 }, endGameScoring: null }, // +3 VP on trade action
  { id: 'helepole', name: 'Helepole', description: 'Spend 1 Troop less when you explore', cost: 1, knowledgeRequirement: { green: 0, blue: 1, red: 0 }, type: 'ONGOING',
    effect: { type: 'GAIN_VP', amount: 0 }, endGameScoring: null }, // Spend 1 less troop when exploring
  { id: 'constructing-the-mint', name: 'Constructing the Mint', description: 'Moving up on the Economy track during the Progress phase is always free for you', cost: 2, knowledgeRequirement: { green: 0, blue: 0, red: 2 }, type: 'ONGOING',
    effect: { type: 'GAIN_VP', amount: 0 }, endGameScoring: null }, // Economy progress is free

  // ── IMMEDIATE cards ──
  { id: 'ostracism', name: 'Ostracism', description: 'Return 1 Card you already played back to your hand. Then, you may take 1 Politics Action', cost: 3, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'IMMEDIATE',
    effect: { type: 'GAIN_VP', amount: 0 }, endGameScoring: null }, // Return 1 played card, take 1 politics action
  { id: 'rivalry', name: 'Rivalry', description: 'If all other players have a Military track level higher than yours, move up 1 Military track level for free', cost: 0, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'IMMEDIATE',
    effect: { type: 'ADVANCE_TRACK', track: 'MILITARY', amount: 1 }, endGameScoring: null }, // If all others have higher military
  { id: 'peripteros', name: 'Peripteros', description: 'Move up 1 level on the Culture track for free', cost: 1, knowledgeRequirement: { green: 2, blue: 0, red: 0 }, type: 'IMMEDIATE',
    effect: { type: 'ADVANCE_TRACK', track: 'CULTURE', amount: 1 }, endGameScoring: null },
  { id: 'quarry', name: 'Quarry', description: 'Gain 1 Taxes', cost: 0, knowledgeRequirement: { green: 0, blue: 0, red: 1 }, type: 'IMMEDIATE',
    effect: { type: 'ADVANCE_TRACK', track: 'TAX', amount: 1 }, endGameScoring: null },
  { id: 'contribution', name: 'Contribution', description: 'Gain 1 Drachma for each minor token you have', cost: 0, knowledgeRequirement: { green: 0, blue: 1, red: 0 }, type: 'IMMEDIATE',
    effect: { type: 'GAIN_COINS', amount: 0 }, endGameScoring: null }, // Gain 1 drachma per minor token
  { id: 'colossus-of-rhodes', name: 'Colossus of Rhodes', description: 'Gain 10 VP', cost: 6, knowledgeRequirement: { green: 1, blue: 1, red: 1 }, type: 'IMMEDIATE',
    effect: { type: 'GAIN_VP', amount: 10 }, endGameScoring: null },
  { id: 'silver-mining', name: 'Silver Mining', description: 'Gain 2 Taxes', cost: 3, knowledgeRequirement: { green: 0, blue: 0, red: 1 }, type: 'IMMEDIATE',
    effect: { type: 'ADVANCE_TRACK', track: 'TAX', amount: 2 }, endGameScoring: null },
  { id: 'scholarly-welcome', name: 'Scholarly Welcome', description: 'Gain 1 minor token of your choice from the supply', cost: 2, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'IMMEDIATE',
    effect: { type: 'GAIN_VP', amount: 0 }, endGameScoring: null }, // Gain 1 minor from supply
  { id: 'tunnel-of-eupalinos', name: 'Tunnel of Eupalinos', description: 'Gain 6 VP', cost: 4, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'IMMEDIATE',
    effect: { type: 'GAIN_VP', amount: 6 }, endGameScoring: null },
  { id: 'gifts-from-the-west', name: 'Gifts from the West', description: 'Gain 3 Drachma', cost: 0, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'IMMEDIATE',
    effect: { type: 'GAIN_COINS', amount: 3 }, endGameScoring: null },
  { id: 'council', name: 'Council', description: 'Draw 2 cards from the deck and add them to your hand', cost: 0, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'IMMEDIATE',
    effect: { type: 'GAIN_VP', amount: 0 }, endGameScoring: null }, // Draw 2 cards
  { id: 'mercenary-recruitment', name: 'Mercenary Recruitment', description: 'Gain troops equal to your economy track level', cost: 0, knowledgeRequirement: { green: 0, blue: 0, red: 1 }, type: 'IMMEDIATE',
    effect: { type: 'ADVANCE_TRACK', track: 'TROOP', amount: 0 }, endGameScoring: null }, // Gain troops = economy level
  { id: 'archives', name: 'Archives', description: 'Gain 3 scrolls', cost: 2, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'IMMEDIATE',
    effect: { type: 'GAIN_PHILOSOPHY_TOKENS', amount: 3 }, endGameScoring: null },
  { id: 'greek-fire', name: 'Greek Fire', description: 'Gain 4 troops', cost: 0, knowledgeRequirement: { green: 0, blue: 1, red: 0 }, type: 'IMMEDIATE',
    effect: { type: 'ADVANCE_TRACK', track: 'TROOP', amount: 4 }, endGameScoring: null },
];

// ─── EVENT CARDS ─────────────────────────────────────────────────────────────

/** The starting event (always round 1). */
export const STARTING_EVENT: EventCard = {
  id: 'growing-populations',
  name: 'Growing Populations',
  immediateEffect: null, // Handled specially during dice phase
  gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'During dice phase: players who roll ≤4 total gain 1 scroll' },
  penaltyEffect: null,
  triggerDuringDice: true,
};

/** The final round event (always round 9). */
export const FINAL_EVENT: EventCard = {
  id: 'conquest-of-persians',
  name: 'Conquest of the Persians',
  immediateEffect: null, // If Persepolis explored, each player takes any non-military action
  gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'If Persepolis explored, take any non-military action' },
  penaltyEffect: null,
};

/** Random events shuffled for rounds 2-8. */
export const RANDOM_EVENTS: EventCard[] = [
  { id: 'plague-of-athens', name: 'Plague of Athens',
    immediateEffect: { type: 'LOSE_CITIZENS', amount: 2 },
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'All players lose 2 Citizens' },
    penaltyEffect: null },
  { id: 'origin-of-academy', name: 'Origin of the Academy',
    immediateEffect: null,
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'Highest troops: +1 scroll. Lowest troops: lose all scrolls' },
    penaltyEffect: null },
  { id: 'oracle-of-delphi', name: 'Oracle of Delphi',
    immediateEffect: null,
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'All players lose 1 token. If you lost one, gain 2 scrolls' },
    penaltyEffect: null },
  { id: 'conscripting-troops', name: 'Conscripting Troops',
    immediateEffect: null,
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'Highest troops: +3 citizens. Lowest troops: -3 citizens' },
    penaltyEffect: null },
  { id: 'eleusinian-mysteries', name: 'Eleusinian Mysteries',
    immediateEffect: null,
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'Highest troops: +4 VP. Lowest troops: -4 VP' },
    penaltyEffect: null },
  { id: 'supplies-from-lydia', name: 'Supplies from Lydia',
    immediateEffect: { type: 'GAIN_COINS', amount: 3 },
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'All players gain 3 Drachma' },
    penaltyEffect: null },
  { id: 'military-victory', name: 'Military Victory',
    immediateEffect: null,
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'Highest troops: pay 2 fewer Drachma to progress 1 level' },
    penaltyEffect: null },
  { id: 'prosperity', name: 'Prosperity',
    immediateEffect: null,
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'Highest troops: take 1 politics action' },
    penaltyEffect: null },
  { id: 'invention-of-trireme', name: 'Invention of the Trireme',
    immediateEffect: { type: 'ADVANCE_TRACK', track: 'TROOP', amount: 3 },
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'All players gain 3 troops' },
    penaltyEffect: null },
  { id: 'drought', name: 'Drought',
    immediateEffect: { type: 'LOSE_COINS', amount: 2 },
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'All players lose 2 Drachma' },
    penaltyEffect: null },
  { id: 'savior-of-greece', name: 'The Savior of Greece',
    immediateEffect: null,
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'Highest troops: +2 Drachma. Lowest troops: -2 Drachma' },
    penaltyEffect: null },
  { id: 'rise-of-persia', name: 'The Rise of Persia',
    immediateEffect: null,
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'Pay 2 fewer Drachma to progress 1 level on military track' },
    penaltyEffect: null },
  { id: 'outbreak-of-war', name: 'Outbreak of War',
    immediateEffect: { type: 'ADVANCE_TRACK', track: 'TROOP', amount: -2 },
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'All players lose 2 troops' },
    penaltyEffect: null },
  { id: 'thirty-tyrants', name: 'The Thirty Tyrants',
    immediateEffect: null,
    gloryCondition: { type: 'CUSTOM', evaluate: () => false, description: 'Highest troops: draw 2 cards. Lowest troops: discard 2 cards' },
    penaltyEffect: null },
];

// ─── CITY STATES ─────────────────────────────────────────────────────────────

export const ALL_CITIES: CityCard[] = [
  {
    id: 'corinth', name: 'Corinth',
    startingCoins: 4,
    startingTracks: { economy: 1, culture: 1, military: 1, tax: 0, glory: 0, troop: 0, citizen: 3 },
    developments: [
      { id: 'corinth-dev-1', name: 'Gain 4 Drachma', level: 1,
        knowledgeRequirement: { green: 0, blue: 0, red: 0 }, drachmaCost: 0,
        effect: { type: 'GAIN_COINS', amount: 4 }, effectType: 'IMMEDIATE' },
      { id: 'corinth-dev-2', name: 'Gain taxes and scrolls = token count', level: 2,
        knowledgeRequirement: { green: 0, blue: 0, red: 1 }, drachmaCost: 1,
        effect: { type: 'COMPOSITE', effects: [{ type: 'ADVANCE_TRACK', track: 'TAX', amount: 0 }, { type: 'GAIN_PHILOSOPHY_TOKENS', amount: 0 }] }, effectType: 'IMMEDIATE' },
      { id: 'corinth-dev-3', name: 'During the progress phase, you may increase up to a total of 2 levels on the track(s) of your choice. Each progress costs you 1 drachma less.', level: 3,
        knowledgeRequirement: { green: 1, blue: 1, red: 2 }, drachmaCost: 2,
        effect: { type: 'GAIN_VP', amount: 0 }, effectType: 'ONGOING' },
      { id: 'corinth-dev-4', name: 'Gain 2 VP per token you have', level: 4,
        knowledgeRequirement: { green: 2, blue: 2, red: 0 }, drachmaCost: 3,
        effect: { type: 'GAIN_VP', amount: 0 }, effectType: 'END_GAME' },
    ],
  },
  {
    id: 'thebes', name: 'Thebes',
    startingCoins: 4,
    startingTracks: { economy: 1, culture: 1, military: 1, tax: 0, glory: 0, troop: 0, citizen: 3 },
    developments: [
      { id: 'thebes-dev-1', name: 'Move up 1 Military for free', level: 1,
        knowledgeRequirement: { green: 0, blue: 0, red: 0 }, drachmaCost: 0,
        effect: { type: 'ADVANCE_TRACK', track: 'MILITARY', amount: 1 }, effectType: 'IMMEDIATE' },
      { id: 'thebes-dev-2', name: 'Lose 1 Glory → gain 2 Drachma + 4 VP', level: 2,
        knowledgeRequirement: { green: 1, blue: 1, red: 0 }, drachmaCost: 0,
        effect: { type: 'COMPOSITE', effects: [{ type: 'GAIN_COINS', amount: 2 }, { type: 'GAIN_VP', amount: 4 }] }, effectType: 'ONGOING' },
      { id: 'thebes-dev-3', name: 'Explore twice on military action', level: 3,
        knowledgeRequirement: { green: 1, blue: 2, red: 1 }, drachmaCost: 0,
        effect: { type: 'GAIN_VP', amount: 0 }, effectType: 'ONGOING' },
      { id: 'thebes-dev-4', name: 'Gain 3 VP per minor token', level: 4,
        knowledgeRequirement: { green: 2, blue: 2, red: 0 }, drachmaCost: 2,
        effect: { type: 'GAIN_VP', amount: 0 }, effectType: 'END_GAME' },
    ],
  },
  {
    id: 'miletus', name: 'Miletus',
    startingCoins: 4,
    startingTracks: { economy: 1, culture: 1, military: 1, tax: 0, glory: 0, troop: 0, citizen: 3 },
    developments: [
      { id: 'miletus-dev-1', name: 'Move up 1 Economy for free', level: 1,
        knowledgeRequirement: { green: 0, blue: 0, red: 0 }, drachmaCost: 0,
        effect: { type: 'ADVANCE_TRACK', track: 'ECONOMY', amount: 1 }, effectType: 'IMMEDIATE' },
      { id: 'miletus-dev-2', name: 'Choose 2 tracks, move up 1 each free', level: 2,
        knowledgeRequirement: { green: 0, blue: 0, red: 1 }, drachmaCost: 1,
        effect: { type: 'GAIN_VP', amount: 0 }, effectType: 'IMMEDIATE' },
      { id: 'miletus-dev-3', name: '+3 VP on trade action', level: 3,
        knowledgeRequirement: { green: 1, blue: 0, red: 2 }, drachmaCost: 2,
        effect: { type: 'GAIN_VP', amount: 3 }, effectType: 'ONGOING' },
      { id: 'miletus-dev-4', name: 'Gain 15 VP', level: 4,
        knowledgeRequirement: { green: 2, blue: 0, red: 3 }, drachmaCost: 4,
        effect: { type: 'GAIN_VP', amount: 15 }, effectType: 'IMMEDIATE' },
    ],
  },
  {
    id: 'sparta', name: 'Sparta',
    startingCoins: 4,
    startingTracks: { economy: 1, culture: 1, military: 1, tax: 0, glory: 0, troop: 0, citizen: 3 },
    developments: [
      { id: 'sparta-dev-1', name: 'Lose 1 less troop when exploring', level: 1,
        knowledgeRequirement: { green: 0, blue: 0, red: 0 }, drachmaCost: 0,
        effect: { type: 'GAIN_VP', amount: 0 }, effectType: 'ONGOING' },
      { id: 'sparta-dev-2', name: '+1 taxes on military action', level: 2,
        knowledgeRequirement: { green: 0, blue: 2, red: 0 }, drachmaCost: 2,
        effect: { type: 'ADVANCE_TRACK', track: 'TAX', amount: 1 }, effectType: 'ONGOING' },
      { id: 'sparta-dev-3', name: 'Take 2 military actions', level: 3,
        knowledgeRequirement: { green: 1, blue: 3, red: 1 }, drachmaCost: 2,
        effect: { type: 'GAIN_VP', amount: 0 }, effectType: 'IMMEDIATE' },
      { id: 'sparta-dev-4', name: 'Gain 4 VP per blue token', level: 4,
        knowledgeRequirement: { green: 2, blue: 3, red: 2 }, drachmaCost: 4,
        effect: { type: 'GAIN_VP', amount: 0 }, effectType: 'END_GAME' },
    ],
  },
  {
    id: 'olympia', name: 'Olympia',
    startingCoins: 4,
    startingTracks: { economy: 1, culture: 1, military: 1, tax: 0, glory: 0, troop: 0, citizen: 3 },
    developments: [
      { id: 'olympia-dev-1', name: 'Gain 1 taxes', level: 1,
        knowledgeRequirement: { green: 0, blue: 0, red: 0 }, drachmaCost: 0,
        effect: { type: 'ADVANCE_TRACK', track: 'TAX', amount: 1 }, effectType: 'IMMEDIATE' },
      { id: 'olympia-dev-2', name: '+1 troop +1 scroll on culture', level: 2,
        knowledgeRequirement: { green: 1, blue: 0, red: 0 }, drachmaCost: 0,
        effect: { type: 'COMPOSITE', effects: [{ type: 'ADVANCE_TRACK', track: 'TROOP', amount: 1 }, { type: 'GAIN_PHILOSOPHY_TOKENS', amount: 1 }] }, effectType: 'ONGOING' },
      { id: 'olympia-dev-3', name: 'Move up 2 Culture for free', level: 3,
        knowledgeRequirement: { green: 2, blue: 0, red: 1 }, drachmaCost: 2,
        effect: { type: 'ADVANCE_TRACK', track: 'CULTURE', amount: 2 }, effectType: 'IMMEDIATE' },
      { id: 'olympia-dev-4', name: 'Take 3 culture actions', level: 4,
        knowledgeRequirement: { green: 3, blue: 1, red: 2 }, drachmaCost: 3,
        effect: { type: 'GAIN_VP', amount: 0 }, effectType: 'IMMEDIATE' },
    ],
  },
  {
    id: 'argos', name: 'Argos',
    startingCoins: 4,
    startingTracks: { economy: 1, culture: 1, military: 1, tax: 0, glory: 0, troop: 0, citizen: 3 },
    developments: [
      { id: 'argos-dev-1', name: 'Gain 2 troops', level: 1,
        knowledgeRequirement: { green: 0, blue: 0, red: 0 }, drachmaCost: 0,
        effect: { type: 'ADVANCE_TRACK', track: 'TROOP', amount: 2 }, effectType: 'IMMEDIATE' },
      { id: 'argos-dev-2', name: 'Gain 2 troops, or 3 Drachma, or 4 VP, or 5 citizens', level: 2,
        knowledgeRequirement: { green: 0, blue: 2, red: 0 }, drachmaCost: 0,
        effect: { type: 'GAIN_VP', amount: 0 }, effectType: 'IMMEDIATE' },
      { id: 'argos-dev-3', name: 'Move up 1 Military for free', level: 3,
        knowledgeRequirement: { green: 0, blue: 2, red: 1 }, drachmaCost: 0,
        effect: { type: 'ADVANCE_TRACK', track: 'MILITARY', amount: 1 }, effectType: 'IMMEDIATE' },
      { id: 'argos-dev-4', name: 'Gain 2 glory', level: 4,
        knowledgeRequirement: { green: 2, blue: 3, red: 1 }, drachmaCost: 2,
        effect: { type: 'ADVANCE_TRACK', track: 'GLORY', amount: 2 }, effectType: 'IMMEDIATE' },
    ],
  },
  {
    id: 'athens', name: 'Athens',
    startingCoins: 4,
    startingTracks: { economy: 1, culture: 1, military: 1, tax: 0, glory: 0, troop: 0, citizen: 3 },
    developments: [
      { id: 'athens-dev-1', name: 'Gain 3 scrolls', level: 1,
        knowledgeRequirement: { green: 0, blue: 0, red: 0 }, drachmaCost: 0,
        effect: { type: 'GAIN_PHILOSOPHY_TOKENS', amount: 3 }, effectType: 'IMMEDIATE' },
      { id: 'athens-dev-2', name: 'When you play a card, gain 2 Drachma + 3 VP', level: 2,
        knowledgeRequirement: { green: 1, blue: 0, red: 1 }, drachmaCost: 0,
        effect: { type: 'COMPOSITE', effects: [{ type: 'GAIN_COINS', amount: 2 }, { type: 'GAIN_VP', amount: 3 }] }, effectType: 'ONGOING' },
      { id: 'athens-dev-3', name: 'When you play a card, gain 2 troops', level: 3,
        knowledgeRequirement: { green: 0, blue: 2, red: 0 }, drachmaCost: 1,
        effect: { type: 'ADVANCE_TRACK', track: 'TROOP', amount: 2 }, effectType: 'ONGOING' },
      { id: 'athens-dev-4', name: 'Gain 3 VP per card in play', level: 4,
        knowledgeRequirement: { green: 2, blue: 2, red: 2 }, drachmaCost: 2,
        effect: { type: 'GAIN_VP', amount: 0 }, effectType: 'END_GAME' },
    ],
  },
];

// ─── HELPER: Build event deck ────────────────────────────────────────────────

function shuffle<T>(array: T[]): T[] {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Builds the 9-card event deck: Growing Populations first, 7 random, Conquest last. */
export function buildEventDeck(): EventCard[] {
  const middle = shuffle(RANDOM_EVENTS).slice(0, 7);
  return [STARTING_EVENT, ...middle, FINAL_EVENT];
}

/** Returns a shuffled copy of all politics cards. */
export function buildPoliticsDeck(): PoliticsCard[] {
  return shuffle([...ALL_POLITICS_CARDS]);
}

/** Returns all city cards. */
export function getAllCityCards(): CityCard[] {
  return [...ALL_CITIES];
}
