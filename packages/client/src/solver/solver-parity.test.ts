import { describe, expect, it } from 'vitest';
import type { GameState, KnowledgeColor, PlayerState } from '@khora/shared';
import {
  applyImmediateCardEffect as applyServerImmediateCardEffect,
  applyOngoingEffects as applyServerOngoingEffects,
} from '../../../server/src/card-handlers';
import { ALL_POLITICS_CARDS } from '../../../server/src/game-data';
import { LegislationResolver } from '../../../server/src/actions/legislation-resolver';
import { TaxationPhaseManager } from '../../../server/src/phases/taxation-phase';
import { applyTaxPhase } from './scoring';
import {
  applyImmediateCardEffect as applySolverImmediateCardEffect,
  applyOngoingOnAction as applySolverOngoingOnAction,
} from './card-data';
import type { SolverState } from './types';

const PLAYER_ID = 'p1';

describe('solver card-effect parity', () => {
  it.each([
    ['gifts-from-the-west', undefined],
    ['archives', undefined],
    ['tunnel-of-eupalinos', undefined],
    ['colossus-of-rhodes', undefined],
    ['quarry', undefined],
    ['silver-mining', undefined],
    ['greek-fire', undefined],
    ['peripteros', undefined],
    ['contribution', undefined],
    ['mercenary-recruitment', undefined],
    ['scholarly-welcome', 'BLUE' as KnowledgeColor],
  ])('mirrors server immediate effect for %s', (cardId, scholarlyWelcomeColor) => {
    const serverState = applyServerImmediateCardEffect(
      baseGameState(),
      PLAYER_ID,
      cardId,
      scholarlyWelcomeColor ? { scholarlyWelcomeColor } : undefined,
    );
    const solverState = baseSolverState();
    applySolverImmediateCardEffect(
      solverState,
      cardId,
      [],
      scholarlyWelcomeColor ? { scholarlyWelcomeColor } : undefined,
    );

    const serverPlayer = serverState.players[0];
    expect(projectSolverState(solverState)).toEqual(projectPlayerState(serverPlayer));
  });

  it('mirrors server tax phase income and ongoing card effects', () => {
    const cardIds = ['stadion', 'power', 'public-market'];
    const playedCards = cardIds.map(cardById);
    const serverState = {
      ...baseGameState(),
      players: [
        {
          ...basePlayer(),
          playedCards,
          coins: 4,
          economyTrack: 4,
          cultureTrack: 2,
          taxTrack: 3,
          troopTrack: 10,
          victoryPoints: 8,
        },
        {
          ...basePlayer(),
          playerId: 'p2',
          playerName: 'Opponent',
          economyTrack: 3,
          cultureTrack: 3,
          playedCards: [],
        },
      ],
      turnOrder: [PLAYER_ID, 'p2'],
    };

    const serverAfter = new TaxationPhaseManager().onEnter(serverState).players[0];
    const solverState = {
      ...baseSolverState(),
      coins: 4,
      economyTrack: 4,
      cultureTrack: 2,
      taxTrack: 3,
      troopTrack: 10,
      victoryPoints: 8,
      playedMask: cardIds.reduce((mask, _id, index) => mask | (1 << index), 0),
    };
    applyTaxPhase(
      solverState,
      [{ economyTrack: 3, cultureTrack: 3, militaryTrack: 4 }],
      (id) => cardIds.includes(id),
    );

    expect(projectSolverState(solverState)).toEqual(projectPlayerState(serverAfter));
  });

  it('mirrors Amnesty for Socrates on legislation action', () => {
    const amnesty = cardById('amnesty-for-socrates');
    const serverStart = {
      ...baseGameState(),
      politicsDeck: [cardById('gifts-from-the-west'), cardById('archives')],
      players: [{
        ...basePlayer(),
        playedCards: [amnesty],
        citizenTrack: 4,
        philosophyTokens: 2,
      }],
    };
    const legislationResult = new LegislationResolver().resolve(
      serverStart,
      PLAYER_ID,
      { targetCardId: 'gifts-from-the-west' },
    );
    expect(legislationResult.ok).toBe(true);
    if (!legislationResult.ok) return;
    const serverAfter = applyServerOngoingEffects(
      legislationResult.value,
      PLAYER_ID,
      { type: 'ON_ACTION', actionType: 'LEGISLATION' },
    ).players[0];

    const solverState = {
      ...baseSolverState(),
      citizenTrack: 4,
      philosophyTokens: 2,
      handSlots: 0,
    };
    solverState.citizenTrack = Math.min(15, solverState.citizenTrack + 3);
    solverState.handSlots += 1;
    applySolverOngoingOnAction(solverState, 'LEGISLATION', id => id === 'amnesty-for-socrates');

    expect(projectSolverState(solverState)).toEqual(projectPlayerState(serverAfter));
  });
});

function baseGameState(): GameState {
  return {
    gameId: 'g1',
    roundNumber: 3,
    currentPhase: 'ACTIONS',
    players: [basePlayer()],
    predeterminedDice: {},
    eventDeck: [],
    currentEvent: null,
    politicsDeck: [],
    centralBoardTokens: [],
    availableAchievements: [],
    claimedAchievements: new Map(),
    startPlayerId: PLAYER_ID,
    turnOrder: [PLAYER_ID],
    gameLog: [],
    pendingDecisions: [],
    disconnectedPlayers: new Map(),
    draftMode: 'STANDARD',
    draftState: null,
    finalScores: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function basePlayer(): PlayerState {
  return {
    playerId: PLAYER_ID,
    playerName: 'Tester',
    cityId: 'athens',
    coins: 5,
    economyTrack: 3,
    cultureTrack: 2,
    militaryTrack: 4,
    taxTrack: 1,
    gloryTrack: 2,
    troopTrack: 3,
    citizenTrack: 4,
    philosophyTokens: 1,
    knowledgeTokens: [
      { id: 'g1', color: 'GREEN', tokenType: 'MINOR' },
      { id: 'r1', color: 'RED', tokenType: 'MINOR' },
    ],
    handCards: [],
    playedCards: [],
    developmentLevel: 1,
    diceRoll: null,
    diceRollHistory: [],
    actionSlots: [null, null, null],
    victoryPoints: 7,
    isConnected: true,
    hasFlagged: false,
    timeBankMs: 120_000,
  };
}

function baseSolverState(): SolverState {
  return {
    round: 3,
    actionsAlreadyTaken: [],
    slotsConsumedThisRound: 0,
    progressAlreadyDone: false,
    legislationDoneThisRound: false,
    economyTrack: 3,
    cultureTrack: 2,
    militaryTrack: 4,
    taxTrack: 1,
    gloryTrack: 2,
    troopTrack: 3,
    citizenTrack: 4,
    coins: 5,
    philosophyTokens: 1,
    knowledge: {
      greenMinor: 1,
      blueMinor: 0,
      redMinor: 1,
      greenMajor: 0,
      blueMajor: 0,
      redMajor: 0,
    },
    cityId: 'athens',
    developmentLevel: 1,
    handMask: 0,
    playedMask: 0,
    handSlots: 0,
    godMode: false,
    boardTokens: [],
    availableAchievementIds: [],
    victoryPoints: 7,
  };
}

function projectPlayerState(player: PlayerState) {
  const counts = { greenMinor: 0, blueMinor: 0, redMinor: 0, greenMajor: 0, blueMajor: 0, redMajor: 0 };
  for (const token of player.knowledgeTokens) {
    const key = `${token.color.toLowerCase()}${token.tokenType === 'MAJOR' ? 'Major' : 'Minor'}` as keyof typeof counts;
    counts[key] += 1;
  }
  return {
    coins: player.coins,
    philosophyTokens: player.philosophyTokens,
    victoryPoints: player.victoryPoints,
    economyTrack: player.economyTrack,
    cultureTrack: player.cultureTrack,
    militaryTrack: player.militaryTrack,
    taxTrack: player.taxTrack,
    gloryTrack: player.gloryTrack,
    troopTrack: player.troopTrack,
    citizenTrack: player.citizenTrack,
    knowledge: counts,
  };
}

function projectSolverState(state: SolverState) {
  return {
    coins: state.coins,
    philosophyTokens: state.philosophyTokens,
    victoryPoints: state.victoryPoints,
    economyTrack: state.economyTrack,
    cultureTrack: state.cultureTrack,
    militaryTrack: state.militaryTrack,
    taxTrack: state.taxTrack,
    gloryTrack: state.gloryTrack,
    troopTrack: state.troopTrack,
    citizenTrack: state.citizenTrack,
    knowledge: state.knowledge,
  };
}

function cardById(id: string) {
  const card = ALL_POLITICS_CARDS.find(c => c.id === id);
  if (!card) throw new Error(`Missing card fixture: ${id}`);
  return card;
}
