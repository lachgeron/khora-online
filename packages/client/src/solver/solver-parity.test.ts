import { describe, expect, it } from 'vitest';
import type { GameState, KnowledgeColor, PlayerState } from '@khora/shared';
import { applyImmediateCardEffect as applyServerImmediateCardEffect } from '../../../server/src/card-handlers';
import { applyImmediateCardEffect as applySolverImmediateCardEffect } from './card-data';
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
    taxTrack: player.taxTrack,
    troopTrack: player.troopTrack,
    knowledge: counts,
  };
}

function projectSolverState(state: SolverState) {
  return {
    coins: state.coins,
    philosophyTokens: state.philosophyTokens,
    victoryPoints: state.victoryPoints,
    taxTrack: state.taxTrack,
    troopTrack: state.troopTrack,
    knowledge: state.knowledge,
  };
}
