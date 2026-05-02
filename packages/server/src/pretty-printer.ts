/**
 * Pretty printer for Khora Online GameState.
 *
 * Formats GameState into human-readable structured text and parses it back.
 */

import type { GameState, PlayerState, EventCard } from '@khora/shared';
import type { GamePhase } from '@khora/shared';

/**
 * Format a GameState into human-readable structured text.
 */
export function formatGameState(state: GameState): string {
  const lines: string[] = [];

  lines.push(`=== Khora Game State ===`);
  lines.push(`GameId: ${state.gameId}`);
  lines.push(`Round: ${state.roundNumber}`);
  lines.push(`Phase: ${state.currentPhase}`);
  lines.push(`CreatedAt: ${state.createdAt}`);
  lines.push(`UpdatedAt: ${state.updatedAt}`);
  lines.push(``);

  if (state.currentEvent) {
    lines.push(`--- Current Event ---`);
    lines.push(`EventId: ${state.currentEvent.id}`);
    lines.push(`EventName: ${state.currentEvent.name}`);
    lines.push(``);
  } else {
    lines.push(`--- Current Event ---`);
    lines.push(`None`);
    lines.push(``);
  }

  lines.push(`DeckSize: ${state.politicsDeck.length}`);
  lines.push(`EventDeckSize: ${state.eventDeck.length}`);
  lines.push(`CentralBoardTokens: ${state.centralBoardTokens.length}`);
  lines.push(`AchievementsAvailable: ${state.availableAchievements.length}`);
  lines.push(``);

  lines.push(`--- Players (${state.players.length}) ---`);
  for (const p of state.players) {
    lines.push(`Player: ${p.playerId}`);
    lines.push(`  Name: ${p.playerName}`);
    lines.push(`  City: ${p.cityId}`);
    lines.push(`  Connected: ${p.isConnected}`);
    lines.push(`  Coins: ${p.coins}`);
    lines.push(`  EconomyTrack: ${p.economyTrack}`);
    lines.push(`  CultureTrack: ${p.cultureTrack}`);
    lines.push(`  MilitaryTrack: ${p.militaryTrack}`);
    lines.push(`  TaxTrack: ${p.taxTrack}`);
    lines.push(`  GloryTrack: ${p.gloryTrack}`);
    lines.push(`  TroopTrack: ${p.troopTrack}`);
    lines.push(`  CitizenTrack: ${p.citizenTrack}`);
    lines.push(`  PhilosophyTokens: ${p.philosophyTokens}`);
    lines.push(`  KnowledgeTokens: ${p.knowledgeTokens.length}`);
    lines.push(`  VictoryPoints: ${p.victoryPoints}`);
    lines.push(`  HandCards: ${p.handCards.length}`);
    lines.push(`  PlayedCards: ${p.playedCards.length}`);
    lines.push(`  DevelopmentLevel: ${p.developmentLevel}`);
  }
  lines.push(``);
  lines.push(`=== End ===`);

  return lines.join('\n');
}

/**
 * Parse a formatted text back into a partial GameState.
 * Only reconstructs the fields that are present in the formatted output.
 */
export function parseGameState(text: string): GameState {
  const lines = text.split('\n');
  const getValue = (prefix: string): string => {
    const line = lines.find((l) => l.trimStart().startsWith(prefix));
    if (!line) return '';
    return line.substring(line.indexOf(prefix) + prefix.length).trim();
  };

  const gameId = getValue('GameId: ');
  const roundNumber = parseInt(getValue('Round: '), 10);
  const currentPhase = getValue('Phase: ') as GamePhase;
  const createdAt = parseInt(getValue('CreatedAt: '), 10);
  const updatedAt = parseInt(getValue('UpdatedAt: '), 10);

  let currentEvent: EventCard | null = null;
  const eventId = getValue('EventId: ');
  if (eventId) {
    const eventName = getValue('EventName: ');
    currentEvent = {
      id: eventId,
      name: eventName,
      immediateEffect: null,
      gloryCondition: { type: 'CUSTOM', evaluate: () => true, description: '' },
      penaltyEffect: null,
    };
  }

  const deckSize = parseInt(getValue('DeckSize: '), 10) || 0;
  const eventDeckSize = parseInt(getValue('EventDeckSize: '), 10) || 0;
  const achievementsAvailable = parseInt(getValue('AchievementsAvailable: '), 10) || 0;

  const players: PlayerState[] = [];
  const playerIndices: number[] = [];
  lines.forEach((line, i) => {
    if (line.startsWith('Player: ')) playerIndices.push(i);
  });

  for (const idx of playerIndices) {
    const getPlayerVal = (prefix: string): string => {
      for (let i = idx; i < Math.min(idx + 25, lines.length); i++) {
        if (lines[i].trimStart().startsWith(prefix)) {
          return lines[i].substring(lines[i].indexOf(prefix) + prefix.length).trim();
        }
      }
      return '';
    };

    players.push({
      playerId: lines[idx].substring('Player: '.length).trim(),
      playerName: getPlayerVal('Name: '),
      cityId: getPlayerVal('City: '),
      isConnected: getPlayerVal('Connected: ') === 'true',
      hasFlagged: false,
      coins: parseInt(getPlayerVal('Coins: '), 10) || 0,
      economyTrack: parseInt(getPlayerVal('EconomyTrack: '), 10) || 0,
      cultureTrack: parseInt(getPlayerVal('CultureTrack: '), 10) || 0,
      militaryTrack: parseInt(getPlayerVal('MilitaryTrack: '), 10) || 0,
      taxTrack: parseInt(getPlayerVal('TaxTrack: '), 10) || 0,
      gloryTrack: parseInt(getPlayerVal('GloryTrack: '), 10) || 0,
      troopTrack: parseInt(getPlayerVal('TroopTrack: '), 10) || 0,
      citizenTrack: parseInt(getPlayerVal('CitizenTrack: '), 10) || 0,
      philosophyTokens: parseInt(getPlayerVal('PhilosophyTokens: '), 10) || 0,
      knowledgeTokens: [],
      victoryPoints: parseInt(getPlayerVal('VictoryPoints: '), 10) || 0,
      handCards: [],
      playedCards: [],
      developmentLevel: parseInt(getPlayerVal('DevelopmentLevel: '), 10) || 0,
      diceRoll: null,
      diceRollHistory: [],
      actionSlots: [null, null, null],
      timeBankMs: 120_000,
    });
  }

  return {
    gameId,
    roundNumber,
    currentPhase,
    players,
    predeterminedDice: {},
    eventDeck: new Array(eventDeckSize).fill(null).map((_, i) => ({
      id: `event-placeholder-${i}`,
      name: '',
      immediateEffect: null,
      gloryCondition: { type: 'CUSTOM' as const, evaluate: () => true, description: '' },
      penaltyEffect: null,
    })),
    currentEvent,
    politicsDeck: new Array(deckSize).fill(null).map((_, i) => ({
      id: `deck-placeholder-${i}`,
      name: '',
      description: '',
      cost: 0,
      knowledgeRequirement: { green: 0, blue: 0, red: 0 },
      type: 'IMMEDIATE' as const,
      effect: { type: 'GAIN_VP' as const, amount: 0 },
      endGameScoring: null,
    })),
    centralBoardTokens: [],
    availableAchievements: new Array(achievementsAvailable).fill(null).map((_, i) => ({
      id: `achievement-placeholder-${i}`,
      name: '',
      condition: { type: 'CUSTOM' as const, evaluate: () => true, description: '' },
    })),
    claimedAchievements: new Map(),
    startPlayerId: players[0]?.playerId ?? '',
    turnOrder: players.map(p => p.playerId),
    gameLog: [],
    pendingDecisions: [],
    disconnectedPlayers: new Map(),
    draftMode: 'STANDARD',
    draftState: null,
    finalScores: null,
    createdAt,
    updatedAt,
  };
}
