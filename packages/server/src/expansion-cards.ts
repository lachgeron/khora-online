import type { PoliticsCard, GameEffect, ScoringRule } from '@khora/shared';

function card(id: string, name: string, type: PoliticsCard['type'], cost: number, green: number, blue: number, red: number, description: string, effect: GameEffect = { type: 'GAIN_VP', amount: 0 }, endGameScoring: ScoringRule | null = null): PoliticsCard {
  return { id, name, type, cost, knowledgeRequirement: { green, blue, red }, description, effect, endGameScoring, expansion: true };
}

/** Names, costs and timing from the supplied expansion spreadsheet. */
export const EXPANSION_POLITICS_CARDS: PoliticsCard[] = [
  card('palestra', 'Palestra', 'END_GAME', 2, 1, 1, 0, 'At the end of the game, gain 4 VP for each yellow card played.', undefined, { type: 'PER_CARD', calculate: p => p.playedCards.filter(c => c.type === 'IMMEDIATE').length * 4, description: '4 VP per yellow (immediate) card played' }),
  card('hades', 'Hades', 'END_GAME', 1, 2, 1, 0, 'After counting final VP, gain 1 additional VP for every 10 VP (rounded down).', undefined, { type: 'CUSTOM', calculate: () => 0, description: '1 VP per 10 final VP, before Hades' }),
  card('great-library', 'Great Library', 'END_GAME', 3, 3, 0, 0, 'At the end of the game, gain 3 VP for each scroll you own.', undefined, { type: 'PER_RESOURCE', calculate: p => p.philosophyTokens * 3, description: '3 VP per scroll' }),
  card('favour-of-the-gods', 'Favour of the gods', 'END_GAME', 0, 1, 1, 1, 'Gain 5 VP for each other player with strictly more Glory.', undefined, { type: 'CUSTOM', calculate: () => 0, description: '5 VP per opponent with strictly more Glory' }),
  card('slaves-market', 'Slaves Market', 'ONGOING', 0, 0, 1, 1, 'Every time you take the military action, obtain 1 drachma.', { type: 'GAIN_COINS', amount: 1 }),
  card('enlistment', 'Enlistment', 'ONGOING', 2, 0, 1, 1, 'During the tax phase, you may lose 1 citizen to obtain 1 troop.'),
  card('xenophons-memoirs', "Xenophon's memoirs", 'ONGOING', 1, 0, 1, 0, 'When you take a philosophy action, gain 2 troops.', { type: 'ADVANCE_TRACK', track: 'TROOP', amount: 2 }),
  card('frescoes-by-polygnotus', 'Frescoes by Polygnotus', 'ONGOING', 2, 0, 0, 0, 'Whenever you would gain a Glory level, you may gain 3 VP instead.'),
  card('ecclesia', 'Ecclesia', 'ONGOING', 2, 0, 0, 0, 'When you take legislation, draw 1 additional card before choosing which to keep.'),
  card('strategist', 'Strategist', 'ONGOING', 1, 0, 2, 0, 'Your military actions take precedence over your adversaries (except Rhodes).'),
  card('epidaurus', 'Epidaurus', 'ONGOING', 0, 1, 0, 1, 'Every time you take culture, obtain 1 scroll or 1 drachma.'),
  card('architect', 'Architect', 'ONGOING', 1, 2, 0, 0, 'When you take development, you may pay 1 additional drachma to play 1 card from your hand.'),
  card('the-seven-wonders', 'The seven wonders', 'IMMEDIATE', 7, 1, 0, 0, 'Gain 12 VP.', { type: 'GAIN_VP', amount: 12 }),
  card('heraclides', 'Heraclides', 'IMMEDIATE', 0, 0, 1, 0, 'Sacrifice 1 minor token to gain 6 VP.'),
  card('tracian-mercenaries', 'Tracian mercenaries', 'IMMEDIATE', 2, 0, 1, 0, 'Gain 3 troops and 3 VP.', { type: 'COMPOSITE', effects: [{ type: 'ADVANCE_TRACK', track: 'TROOP', amount: 3 }, { type: 'GAIN_VP', amount: 3 }] }),
  card('mausoleum-of-halikarnassos', 'Mausoleum of Halikarnassos', 'IMMEDIATE', 2, 0, 0, 0, 'Choose 1 of the bottom 5 cards of the deck to add to your hand. You may then take another politics action.'),
  card('helots', 'Helots', 'IMMEDIATE', 0, 0, 0, 1, 'Set your Glory to 0. Gain 3 drachma for each level lost.'),
  card('trade-agreement', 'Trade Agreement', 'IMMEDIATE', 0, 0, 0, 1, 'Gain 5 drachma. Your opponents gain 2 drachma each.', { type: 'GAIN_COINS', amount: 5 }),
  card('demagorgy', 'Demagorgy', 'IMMEDIATE', 0, 0, 1, 0, 'Pay up to 3 drachma to obtain twice as many citizens.'),
  card('great-sacrifice', 'Great Sacrifice', 'IMMEDIATE', 3, 0, 0, 1, 'Gain 1 Glory.', { type: 'ADVANCE_TRACK', track: 'GLORY', amount: 1 }),
  card('histories-of-herodotus', 'Histories of Herodotus', 'ONGOING', 2, 1, 0, 0, 'Whenever you take a politics action, gain 1 scroll.', { type: 'GAIN_PHILOSOPHY_TOKENS', amount: 1 }),
];
