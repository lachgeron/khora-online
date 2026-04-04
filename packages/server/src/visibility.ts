/**
 * State visibility filtering for Khora Online.
 *
 * Builds public and private views of the game state so that
 * no player's private info leaks to other players.
 */

import type {
  GameState,
  PlayerState,
  PublicGameState,
  PublicPlayerState,
  PrivatePlayerState,
} from '@khora/shared';
import { ACTION_NUMBERS } from '@khora/shared';
import { getAllCityCards } from './game-data';

/**
 * Extracts public fields from a PlayerState.
 * Track levels, card counts, development level, VP visible to all.
 */
export function buildPublicPlayerState(player: PlayerState): PublicPlayerState {
  return {
    playerId: player.playerId,
    playerName: player.playerName,
    cityId: player.cityId,
    economyTrack: player.economyTrack,
    cultureTrack: player.cultureTrack,
    militaryTrack: player.militaryTrack,
    taxTrack: player.taxTrack,
    gloryTrack: player.gloryTrack,
    troopTrack: player.troopTrack,
    citizenTrack: player.citizenTrack,
    coins: player.coins,
    philosophyTokens: player.philosophyTokens,
    knowledgeTokens: player.knowledgeTokens,
    handCardCount: player.handCards.length,
    playedCardCount: player.playedCards.length,
    playedCardSummaries: player.playedCards.map(c => ({ name: c.name, type: c.type, description: c.description })),
    knowledgeTokenCount: player.knowledgeTokens.length,
    developmentLevel: player.developmentLevel,
    victoryPoints: player.victoryPoints,
    diceRoll: player.diceRoll,
    actionSlots: player.actionSlots
      .filter((s): s is NonNullable<typeof s> => s !== null)
      .map(s => ({ actionType: s.actionType, resolved: s.resolved })),
    isConnected: player.isConnected,
  };
}

/**
 * Extracts private fields for the owning player only.
 * Coins, philosophy tokens, knowledge tokens, dice, cards are private.
 */
export function buildPrivatePlayerState(player: PlayerState): PrivatePlayerState {
  return {
    coins: player.coins,
    philosophyTokens: player.philosophyTokens,
    knowledgeTokens: player.knowledgeTokens,
    diceRoll: player.diceRoll,
    actionSlots: player.actionSlots,
    handCards: player.handCards,
    playedCards: player.playedCards,
    offeredCities: null,
    draftPack: null,
    draftedCards: null,
    legislationDraw: null,
  };
}

/**
 * Builds the public game state visible to all players.
 */
export function buildPublicGameState(state: GameState): PublicGameState {
  const cityDraft = state.draftState?.cityDraft ?? null;
  const politicsDraft = state.draftState?.politicsDraft ?? null;

  return {
    roundNumber: state.roundNumber,
    currentPhase: state.currentPhase,
    currentEvent: state.currentEvent,
    centralBoardTokens: state.centralBoardTokens,
    availableAchievements: state.availableAchievements,
    claimedAchievements: Object.fromEntries(state.claimedAchievements),
    cityCards: Object.fromEntries(getAllCityCards().map(c => [c.id, c])),
    startPlayerId: state.startPlayerId,
    turnOrder: state.turnOrder,
    players: state.players.map(buildPublicPlayerState),
    gameLog: state.gameLog,
    pendingDecisions: state.pendingDecisions.map((d) => ({
      playerId: d.playerId,
      decisionType: d.decisionType,
      timeoutAt: d.timeoutAt,
    })),
    cityDraft: cityDraft
      ? {
          pickOrder: cityDraft.pickOrder,
          currentPickerIndex: cityDraft.currentPickerIndex,
          selections: cityDraft.selections,
          allCities: cityDraft.allCities,
        }
      : null,
    politicsDraft: politicsDraft
      ? {
          draftRound: politicsDraft.draftRound,
          waitingFor: politicsDraft.waitingFor,
          totalRounds: 5,
        }
      : null,
    finalScores: state.finalScores ?? null,
  };
}

/**
 * Returns the filtered state for a specific player.
 */
export function getStateForPlayer(
  state: GameState,
  playerId: string,
): { public: PublicGameState; private: PrivatePlayerState } {
  const publicState = buildPublicGameState(state);

  const player = state.players.find((p) => p.playerId === playerId);

  // Build draft-specific private fields
  const cityDraft = state.draftState?.cityDraft ?? null;
  const politicsDraft = state.draftState?.politicsDraft ?? null;

  const offeredCityIds = cityDraft?.offeredCities[playerId] ?? [];
  const offeredCities = cityDraft && offeredCityIds.length > 0
    ? cityDraft.allCities.filter(c => offeredCityIds.includes(c.id))
    : null;

  const draftPack = politicsDraft?.packs[playerId] ?? null;
  const draftedCards = politicsDraft?.selectedCards[playerId] ?? null;

  // Check if player's next action is LEGISLATION — peek at top 2 cards
  let legislationDraw: import('@khora/shared').PoliticsCard[] | null = null;
  if (player && state.currentPhase === 'ACTIONS') {
    const unresolved = player.actionSlots
      .filter((s): s is NonNullable<typeof s> => s !== null && !s.resolved);
    if (unresolved.length > 0) {
      const lowest = Math.min(...unresolved.map(s => ACTION_NUMBERS[s.actionType]));
      const nextAction = unresolved.find(s => ACTION_NUMBERS[s.actionType] === lowest);
      if (nextAction?.actionType === 'LEGISLATION' && state.politicsDeck.length > 0) {
        legislationDraw = state.politicsDeck.slice(0, Math.min(2, state.politicsDeck.length));
      }
    }
  }

  const privateState: PrivatePlayerState = player
    ? {
        ...buildPrivatePlayerState(player),
        offeredCities,
        draftPack,
        draftedCards,
        legislationDraw,
      }
    : {
        coins: 0,
        philosophyTokens: 0,
        knowledgeTokens: [],
        diceRoll: null,
        actionSlots: [null, null, null],
        handCards: [],
        playedCards: [],
        offeredCities: null,
        draftPack: null,
        draftedCards: null,
        legislationDraw: null,
      };

  return { public: publicState, private: privateState };
}
