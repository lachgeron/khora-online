/**
 * GameEngine — central orchestrator for Khora Online.
 *
 * Receives player decisions, applies them via the state machine and phase managers,
 * and manages game lifecycle from initialization through final scoring.
 */

import type {
  ClientMessage,
  CityCard,
  GameState,
  GamePhase,
  PlayerInfo,
  PlayerState,
  EventCard,
  PoliticsCard,
  AchievementToken,
  Result,
  GameError,
  PublicGameState,
  PrivatePlayerState,
  DraftState,
  DraftMode,
} from '@khora/shared';
import type { KnowledgeToken } from '@khora/shared';

import { StateMachine } from './state-machine';
import type { PhaseManager } from './phases/omen-phase';
import { OmenPhaseManager } from './phases/omen-phase';
import { TaxationPhaseManager } from './phases/taxation-phase';
import { DicePhaseManager } from './phases/dice-phase';
import { ActionPhaseManager } from './phases/action-phase';
import { ProgressPhaseManager } from './phases/progress-phase';
import { GloryPhaseManager } from './phases/glory-phase';
import { AchievementPhaseManager } from './phases/achievement-phase';
import { CitySelectionPhaseManager } from './phases/city-selection-phase';
import { DraftPoliticsPhaseManager } from './phases/draft-politics-phase';
import { PickBanDraftPhaseManager } from './phases/pick-ban-draft-phase';
import { calculateFinalScores } from './scoring-engine';
import { applyDevelopmentEffect } from './city-abilities';
import { getAllCityCards } from './game-data';

/**
 * Determines the next phase given the current phase and round number.
 */
function getNextPhase(currentPhase: GamePhase, roundNumber: number): GamePhase | null {
  switch (currentPhase) {
    case 'CITY_SELECTION': return 'DRAFT_POLITICS';
    case 'DRAFT_POLITICS': return 'OMEN';
    case 'OMEN': return 'TAXATION';
    case 'TAXATION': return 'DICE';
    case 'DICE': return 'ACTIONS';
    case 'ACTIONS': return 'PROGRESS';
    case 'PROGRESS': return 'GLORY';
    case 'GLORY': return 'ACHIEVEMENT';
    case 'ACHIEVEMENT': return roundNumber < 9 ? 'OMEN' : 'FINAL_SCORING';
    case 'FINAL_SCORING': return 'GAME_OVER';
    default: return null;
  }
}

/**
 * Fisher-Yates shuffle (in-place). Returns the same array.
 */
function shuffle<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export class GameEngine {
  private readonly stateMachine: StateMachine;
  private readonly phaseManagers: Map<GamePhase, PhaseManager>;

  constructor(draftMode: DraftMode = 'STANDARD') {
    this.stateMachine = new StateMachine('CITY_SELECTION', 1);
    this.phaseManagers = new Map<GamePhase, PhaseManager>([
      ['CITY_SELECTION', new CitySelectionPhaseManager()],
      ['DRAFT_POLITICS', draftMode === 'PICK_BAN' ? new PickBanDraftPhaseManager() : new DraftPoliticsPhaseManager()],
      ['OMEN', new OmenPhaseManager()],
      ['TAXATION', new TaxationPhaseManager()],
      ['DICE', new DicePhaseManager()],
      ['ACTIONS', new ActionPhaseManager()],
      ['PROGRESS', new ProgressPhaseManager()],
      ['GLORY', new GloryPhaseManager()],
      ['ACHIEVEMENT', new AchievementPhaseManager()],
    ]);
  }

  /**
   * Creates a new game state starting at the CITY_SELECTION phase.
   *
   * Players will pick cities during the city selection phase, then
   * draft politics cards before the main game loop begins.
   */
  initializeGame(
    players: PlayerInfo[],
    allCities: CityCard[],
    eventCards: EventCard[],
    politicsDeck: PoliticsCard[],
    achievements: AchievementToken[],
    centralBoardTokens: KnowledgeToken[] = [],
    draftMode: DraftMode = 'STANDARD',
  ): GameState {
    // Create placeholder player states (no city assigned yet)
    const playerStates: PlayerState[] = players.map((info) => ({
      playerId: info.playerId,
      playerName: info.playerName,
      cityId: '',
      coins: 0,
      economyTrack: 0,
      cultureTrack: 0,
      militaryTrack: 0,
      taxTrack: 0,
      gloryTrack: 0,
      troopTrack: 0,
      citizenTrack: 0,
      philosophyTokens: 0,
      knowledgeTokens: [],
      handCards: [],
      playedCards: [],
      developmentLevel: 0,
      diceRoll: null,
      actionSlots: [null, null, null],
      victoryPoints: 0,
      isConnected: true,
      timeBankMs: 120_000,
    }));

    const eventDeck = [...eventCards];
    const shuffledPolitics = shuffle([...politicsDeck]);
    const turnOrder = playerStates.map(p => p.playerId);
    const startPlayerId = turnOrder[0] ?? '';

    // Reset state machine to CITY_SELECTION round 1
    this.stateMachine.currentPhase = 'CITY_SELECTION';
    this.stateMachine.roundNumber = 1;

    const now = Date.now();

    const state: GameState = {
      gameId: crypto.randomUUID(),
      roundNumber: 1,
      currentPhase: 'CITY_SELECTION',
      players: playerStates,
      eventDeck,
      currentEvent: null,
      politicsDeck: shuffledPolitics,
      centralBoardTokens: [...centralBoardTokens],
      availableAchievements: [...achievements],
      claimedAchievements: new Map(),
      startPlayerId,
      turnOrder,
      gameLog: [],
      pendingDecisions: [],
      disconnectedPlayers: new Map(),
      draftMode,
      draftState: {
        cityDraft: {
          pickOrder: [],
          currentPickerIndex: 0,
          offeredCities: {},
          remainingPool: [...allCities],
          selections: {},
          allCities: [...allCities],
        },
        politicsDraft: null,
        pickBanDraft: null,
      },
      finalScores: null,
      createdAt: now,
      updatedAt: now,
    };

    // Enter the first phase (CITY_SELECTION)
    return this.enterCurrentPhase(state);
  }

  /**
   * Handles a player decision within the current phase.
   */
  handlePlayerDecision(
    state: GameState,
    playerId: string,
    decision: ClientMessage,
  ): Result<GameState, GameError> {
    const manager = this.phaseManagers.get(state.currentPhase);
    if (!manager) {
      return {
        ok: false,
        error: { code: 'WRONG_PHASE', message: `No phase manager for phase ${state.currentPhase}` },
      };
    }

    const result = manager.handleDecision(state, playerId, decision);
    if (!result.ok) return result;

    let newState = { ...result.value, updatedAt: Date.now() };

    if (manager.isComplete(newState)) {
      newState = this.advancePhase(newState);
    }

    return { ok: true, value: newState };
  }

  /**
   * Auto-resolves a pending decision for a player (timeout or disconnect).
   */
  handleTimeout(state: GameState, playerId: string): GameState {
    const manager = this.phaseManagers.get(state.currentPhase);
    if (!manager) return state;

    let newState = manager.autoResolve(state, playerId);
    newState = { ...newState, updatedAt: Date.now() };

    if (manager.isComplete(newState)) {
      newState = this.advancePhase(newState);
    }

    return newState;
  }

  /**
   * Advances the game to the next phase.
   */
  advancePhase(state: GameState): GameState {
    const nextPhase = getNextPhase(state.currentPhase, this.stateMachine.roundNumber);
    if (!nextPhase) return state;

    this.stateMachine.transition(nextPhase);

    let newState: GameState = {
      ...state,
      currentPhase: nextPhase,
      roundNumber: this.stateMachine.roundNumber,
      updatedAt: Date.now(),
    };

    // When transitioning from CITY_SELECTION → DRAFT_POLITICS,
    // apply city selections to player states
    if (state.currentPhase === 'CITY_SELECTION' && nextPhase === 'DRAFT_POLITICS') {
      const cityDraft = state.draftState?.cityDraft;
      if (cityDraft) {
        newState = {
          ...newState,
          players: newState.players.map(p => {
            const cityId = cityDraft.selections[p.playerId];
            const city = cityDraft.allCities.find(c => c.id === cityId);
            if (!city) return p;
            return initializePlayerState({ playerId: p.playerId, playerName: p.playerName }, city);
          }),
        };
      }
    }

    // When transitioning from DRAFT_POLITICS → OMEN,
    // apply drafted cards to player hands and clear draft state
    if (state.currentPhase === 'DRAFT_POLITICS' && nextPhase === 'OMEN') {
      const politicsDraft = state.draftState?.politicsDraft;
      const pickBanDraft = state.draftState?.pickBanDraft;
      if (politicsDraft) {
        newState = {
          ...newState,
          players: newState.players.map(p => ({
            ...p,
            handCards: [...p.handCards, ...(politicsDraft.selectedCards[p.playerId] ?? [])],
          })),
          draftState: null,
        };
      } else if (pickBanDraft) {
        // For pick/ban mode: picked cards go to hand, remaining cards (not banned/picked) stay in deck
        const allBannedIds = new Set(Object.values(pickBanDraft.bannedCards).flatMap(cards => cards.map(c => c.id)));
        const allPickedIds = new Set(Object.values(pickBanDraft.pickedCards).flatMap(cards => cards.map(c => c.id)));
        const remainingDeck = pickBanDraft.allCards.filter(c => !allBannedIds.has(c.id) && !allPickedIds.has(c.id));
        newState = {
          ...newState,
          players: newState.players.map(p => ({
            ...p,
            handCards: [...p.handCards, ...(pickBanDraft.pickedCards[p.playerId] ?? [])],
          })),
          politicsDeck: remainingDeck,
          draftState: null,
        };
      }
    }

    if (nextPhase === 'FINAL_SCORING') {
      const scores = calculateFinalScores(newState);
      newState = { ...newState, finalScores: scores };
      return this.advancePhase(newState);
    }

    if (nextPhase === 'GAME_OVER') {
      return newState;
    }

    newState = this.enterCurrentPhase(newState);
    return newState;
  }

  /**
   * Returns filtered public + private state for a player.
   */
  getFullStateForPlayer(
    state: GameState,
    playerId: string,
  ): { public: PublicGameState; private: PrivatePlayerState } {
    const player = state.players.find((p) => p.playerId === playerId);

    // Build city draft public state
    const cityDraft = state.draftState?.cityDraft;
    const publicCityDraft = cityDraft
      ? {
          pickOrder: cityDraft.pickOrder,
          currentPickerIndex: cityDraft.currentPickerIndex,
          selections: cityDraft.selections,
          allCities: cityDraft.allCities,
        }
      : null;

    // Build politics draft public state
    const politicsDraft = state.draftState?.politicsDraft;
    const publicPoliticsDraft = politicsDraft
      ? {
          draftRound: politicsDraft.draftRound,
          waitingFor: politicsDraft.waitingFor,
          totalRounds: 5,
          passOrder: politicsDraft.passOrder,
        }
      : null;

    // Build pick/ban draft public state
    const pickBanDraft = state.draftState?.pickBanDraft ?? null;
    const publicPickBanDraft = pickBanDraft
      ? {
          allCards: pickBanDraft.allCards,
          bannedCards: pickBanDraft.bannedCards,
          pickedCards: pickBanDraft.pickedCards,
          turnOrder: pickBanDraft.turnOrder,
          currentTurnIndex: pickBanDraft.currentTurnIndex,
          phase: pickBanDraft.phase,
          bansPerPlayer: pickBanDraft.bansPerPlayer,
          picksPerPlayer: pickBanDraft.picksPerPlayer,
        }
      : null;

    const publicState: PublicGameState = {
      roundNumber: state.roundNumber,
      currentPhase: state.currentPhase,
      currentEvent: state.currentEvent,
      centralBoardTokens: state.centralBoardTokens,
      availableAchievements: state.availableAchievements,
      claimedAchievements: Object.fromEntries(state.claimedAchievements),
      cityCards: Object.fromEntries(getAllCityCards().map(c => [c.id, c])),
      startPlayerId: state.startPlayerId,
      turnOrder: state.turnOrder,
      players: state.players.map((p) => ({
        playerId: p.playerId,
        playerName: p.playerName,
        cityId: p.cityId,
        economyTrack: p.economyTrack,
        cultureTrack: p.cultureTrack,
        militaryTrack: p.militaryTrack,
        taxTrack: p.taxTrack,
        gloryTrack: p.gloryTrack,
        troopTrack: p.troopTrack,
        citizenTrack: p.citizenTrack,
        coins: p.coins,
        philosophyTokens: p.philosophyTokens,
        knowledgeTokens: p.knowledgeTokens,
        handCardCount: p.handCards.length,
        playedCardCount: p.playedCards.length,
        playedCardSummaries: p.playedCards.map(c => ({ name: c.name, type: c.type, description: c.description })),
        knowledgeTokenCount: p.knowledgeTokens.length,
        developmentLevel: p.developmentLevel,
        victoryPoints: p.victoryPoints,
        diceRoll: p.diceRoll,
        actionSlots: p.actionSlots
          .filter((s): s is NonNullable<typeof s> => s !== null)
          .map(s => ({ actionType: s.actionType, resolved: s.resolved })),
        isConnected: p.isConnected,
        timeBankMs: p.timeBankMs,
      })),
      gameLog: state.gameLog,
      pendingDecisions: state.pendingDecisions.map((d) => ({
        playerId: d.playerId,
        decisionType: d.decisionType,
        timeoutAt: d.timeoutAt,
        usingTimeBank: d.usingTimeBank,
      })),
      cityDraft: publicCityDraft,
      politicsDraft: publicPoliticsDraft,
      pickBanDraft: publicPickBanDraft,
      draftMode: state.draftMode,
      finalScores: state.finalScores ?? null,
    };

    // Build private draft state for this player
    const offeredCityIds = cityDraft?.offeredCities[playerId] ?? [];
    const offeredCities = cityDraft
      ? cityDraft.allCities.filter(c => offeredCityIds.includes(c.id))
      : null;

    const draftPack = politicsDraft?.packs[playerId] ?? null;
    const draftedCards = politicsDraft?.selectedCards[playerId] ?? null;

    const privateState: PrivatePlayerState = player
      ? {
          coins: player.coins,
          philosophyTokens: player.philosophyTokens,
          knowledgeTokens: player.knowledgeTokens,
          diceRoll: player.diceRoll,
          actionSlots: player.actionSlots,
          handCards: player.handCards,
          playedCards: player.playedCards,
          offeredCities: offeredCities && offeredCities.length > 0 ? offeredCities : null,
          draftPack,
          draftedCards,
          legislationDraw: null,
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

  getStateMachine(): StateMachine {
    return this.stateMachine;
  }

  private enterCurrentPhase(state: GameState): GameState {
    const manager = this.phaseManagers.get(state.currentPhase);
    if (!manager) return state;

    let newState = manager.onEnter(state);

    if (manager.isComplete(newState)) {
      newState = this.advancePhase(newState);
    }

    return newState;
  }
}

/**
 * Creates a PlayerState from a PlayerInfo and CityCard.
 */
function initializePlayerState(info: PlayerInfo, city: CityCard): PlayerState {
  let playerState: PlayerState = {
    playerId: info.playerId,
    playerName: info.playerName,
    cityId: city.id,
    coins: city.startingCoins,
    economyTrack: city.startingTracks.economy,
    cultureTrack: city.startingTracks.culture,
    militaryTrack: city.startingTracks.military,
    taxTrack: city.startingTracks.tax,
    gloryTrack: city.startingTracks.glory,
    troopTrack: city.startingTracks.troop,
    citizenTrack: city.startingTracks.citizen,
    philosophyTokens: 0,
    knowledgeTokens: [],
    handCards: [],
    playedCards: [],
    developmentLevel: 1,
    diceRoll: null,
    actionSlots: [null, null, null],
    victoryPoints: 0,
    isConnected: true,
    timeBankMs: 120_000,
  };

  // Apply the 1st development's immediate effect (already active at game start)
  const firstDev = city.developments[0];
  if (firstDev && firstDev.effectType === 'IMMEDIATE') {
    playerState = applyDevelopmentEffect(playerState, firstDev);
  }

  return playerState;
}
