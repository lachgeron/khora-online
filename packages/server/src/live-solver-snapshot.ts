import type {
  AchievementToken,
  GameState,
  LiveSolverPlayerSnapshot,
  LiveSolverSnapshot,
  PlayerState,
  PoliticsCard,
} from '@khora/shared';
import {
  ALL_POLITICS_CARDS,
  FINAL_EVENT,
  RANDOM_EVENTS,
  STARTING_EVENT,
  getAllAchievements,
} from './game-data';

export function buildLiveSolverSnapshot(state: GameState): LiveSolverSnapshot {
  return {
    gameId: state.gameId,
    roundNumber: state.roundNumber,
    currentPhase: state.currentPhase,
    players: state.players.map(playerToSnapshot),
    predeterminedDice: state.predeterminedDice,
    eventDeckIds: state.eventDeck.map(event => event.id),
    currentEventId: state.currentEvent?.id ?? null,
    politicsDeckIds: state.politicsDeck.map(card => card.id),
    centralBoardTokens: state.centralBoardTokens.map(token => ({ ...token })),
    availableAchievementIds: state.availableAchievements.map(achievement => achievement.id),
    claimedAchievementIds: Object.fromEntries(
      Array.from(state.claimedAchievements.entries())
        .map(([playerId, achievements]) => [playerId, achievements.map(achievement => achievement.id)]),
    ),
    startPlayerId: state.startPlayerId,
    turnOrder: [...state.turnOrder],
    gameLog: state.gameLog.map(entry => ({ ...entry, details: { ...entry.details } })),
    pendingDecisions: state.pendingDecisions.map(decision => ({ ...decision })),
    disconnectedPlayerIds: Array.from(state.disconnectedPlayers.keys()),
    draftMode: state.draftMode,
    finalScores: state.finalScores,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export function gameStateFromLiveSolverSnapshot(snapshot: LiveSolverSnapshot): GameState {
  const politicsById = new Map<string, PoliticsCard>(ALL_POLITICS_CARDS.map(card => [card.id, card]));
  const eventsById = new Map([STARTING_EVENT, ...RANDOM_EVENTS, FINAL_EVENT].map(event => [event.id, event]));
  const achievementsById = new Map(getAllAchievements().map(achievement => [achievement.id, achievement]));

  return {
    gameId: snapshot.gameId,
    roundNumber: snapshot.roundNumber,
    currentPhase: snapshot.currentPhase,
    players: snapshot.players.map(player => playerFromSnapshot(player, politicsById)),
    predeterminedDice: clonePredeterminedDice(snapshot.predeterminedDice),
    eventDeck: snapshot.eventDeckIds.map(id => eventsById.get(id)).filter((event): event is NonNullable<typeof event> => Boolean(event)),
    currentEvent: snapshot.currentEventId ? eventsById.get(snapshot.currentEventId) ?? null : null,
    politicsDeck: snapshot.politicsDeckIds.map(id => politicsById.get(id)).filter((card): card is PoliticsCard => Boolean(card)),
    centralBoardTokens: snapshot.centralBoardTokens.map(token => ({ ...token })),
    availableAchievements: snapshot.availableAchievementIds
      .map(id => achievementsById.get(id))
      .filter((achievement): achievement is AchievementToken => Boolean(achievement)),
    claimedAchievements: new Map(
      Object.entries(snapshot.claimedAchievementIds).map(([playerId, achievementIds]) => [
        playerId,
        achievementIds
          .map(id => achievementsById.get(id))
          .filter((achievement): achievement is AchievementToken => Boolean(achievement)),
      ]),
    ),
    startPlayerId: snapshot.startPlayerId,
    turnOrder: [...snapshot.turnOrder],
    gameLog: snapshot.gameLog.map(entry => ({ ...entry, details: { ...entry.details } })),
    pendingDecisions: snapshot.pendingDecisions.map(decision => ({ ...decision })),
    disconnectedPlayers: new Map(snapshot.disconnectedPlayerIds.map(playerId => [
      playerId,
      { disconnectedAt: snapshot.updatedAt },
    ])),
    draftMode: snapshot.draftMode,
    draftState: null,
    finalScores: snapshot.finalScores,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function playerToSnapshot(player: PlayerState): LiveSolverPlayerSnapshot {
  return {
    playerId: player.playerId,
    playerName: player.playerName,
    cityId: player.cityId,
    coins: player.coins,
    economyTrack: player.economyTrack,
    cultureTrack: player.cultureTrack,
    militaryTrack: player.militaryTrack,
    taxTrack: player.taxTrack,
    gloryTrack: player.gloryTrack,
    troopTrack: player.troopTrack,
    citizenTrack: player.citizenTrack,
    philosophyTokens: player.philosophyTokens,
    knowledgeTokens: player.knowledgeTokens.map(token => ({ ...token })),
    handCardIds: player.handCards.map(card => card.id),
    playedCardIds: player.playedCards.map(card => card.id),
    developmentLevel: player.developmentLevel,
    diceRoll: player.diceRoll ? [...player.diceRoll] : null,
    diceRollHistory: [...(player.diceRollHistory ?? [])],
    actionSlots: player.actionSlots.map(slot => slot ? { ...slot } : null) as PlayerState['actionSlots'],
    victoryPoints: player.victoryPoints,
    isConnected: player.isConnected,
    hasFlagged: player.hasFlagged,
    timeBankMs: player.timeBankMs,
  };
}

function playerFromSnapshot(
  snapshot: LiveSolverPlayerSnapshot,
  politicsById: Map<string, PoliticsCard>,
): PlayerState {
  return {
    playerId: snapshot.playerId,
    playerName: snapshot.playerName,
    cityId: snapshot.cityId,
    coins: snapshot.coins,
    economyTrack: snapshot.economyTrack,
    cultureTrack: snapshot.cultureTrack,
    militaryTrack: snapshot.militaryTrack,
    taxTrack: snapshot.taxTrack,
    gloryTrack: snapshot.gloryTrack,
    troopTrack: snapshot.troopTrack,
    citizenTrack: snapshot.citizenTrack,
    philosophyTokens: snapshot.philosophyTokens,
    knowledgeTokens: snapshot.knowledgeTokens.map(token => ({ ...token })),
    handCards: snapshot.handCardIds.map(id => politicsById.get(id)).filter((card): card is PoliticsCard => Boolean(card)),
    playedCards: snapshot.playedCardIds.map(id => politicsById.get(id)).filter((card): card is PoliticsCard => Boolean(card)),
    developmentLevel: snapshot.developmentLevel,
    diceRoll: snapshot.diceRoll ? [...snapshot.diceRoll] : null,
    diceRollHistory: [...snapshot.diceRollHistory],
    actionSlots: snapshot.actionSlots.map(slot => slot ? { ...slot } : null) as PlayerState['actionSlots'],
    victoryPoints: snapshot.victoryPoints,
    isConnected: snapshot.isConnected,
    hasFlagged: snapshot.hasFlagged,
    timeBankMs: snapshot.timeBankMs,
  };
}

function clonePredeterminedDice(
  schedule: LiveSolverSnapshot['predeterminedDice'],
): LiveSolverSnapshot['predeterminedDice'] {
  return Object.fromEntries(Object.entries(schedule).map(([round, playerDice]) => [
    round,
    Object.fromEntries(Object.entries(playerDice).map(([playerId, dice]) => [playerId, [...dice]])),
  ]));
}
