import { describe, expect, it } from 'vitest';
import type { ActionType, DecisionType, GameState, KnowledgeColor, KnowledgeToken, PlayerState, PoliticsCard } from '@khora/shared';
import { ALL_CITIES, ALL_POLITICS_CARDS } from './game-data';
import { GameServer } from './integration';
import { __liveSolverInternals } from './live-solver';

const COLORS: KnowledgeColor[] = ['GREEN', 'BLUE', 'RED'];

function makeKnowledgeTokens(): KnowledgeToken[] {
  return COLORS.flatMap(color =>
    Array.from({ length: 4 }, (_, index) => ({
      id: `${color.toLowerCase()}-${index}`,
      color,
      tokenType: 'MAJOR' as const,
    })),
  );
}

function makeBoardTokens(): KnowledgeToken[] {
  return [
    { id: 'green-board', color: 'GREEN', tokenType: 'MAJOR', militaryRequirement: 0, skullValue: 0, bonusVP: 1 },
    { id: 'blue-board', color: 'BLUE', tokenType: 'MAJOR', militaryRequirement: 0, skullValue: 1, bonusCoins: 1 },
    { id: 'red-board', color: 'RED', tokenType: 'MAJOR', militaryRequirement: 0, skullValue: 2 },
    { id: 'minor-board', color: 'GREEN', tokenType: 'MINOR', militaryRequirement: 0, skullValue: 0 },
    { id: 'persepolis-board', color: 'RED', tokenType: 'MAJOR', militaryRequirement: 0, skullValue: 3, isPersepolis: true },
  ];
}

function baseState(): GameState {
  const server = new GameServer();
  return server.createAndStartGame(['Pete', 'Ian']);
}

function pending(playerId: string, decisionType: DecisionType): GameState['pendingDecisions'][number] {
  return {
    playerId,
    decisionType,
    timeoutAt: Date.now() + 60_000,
    options: null as unknown,
  };
}

function actionSlot(actionType: ActionType): PlayerState['actionSlots'] {
  return [
    { actionType, assignedDie: 6, citizenCost: 0, resolved: false },
    null,
    null,
  ];
}

function prepareActionState(
  actionType: ActionType,
  configure: (player: PlayerState, state: GameState) => PlayerState,
): { state: GameState; playerId: string } {
  const state = baseState();
  const playerId = state.players[0].playerId;
  const configured = configure({
    ...state.players[0],
    cityId: 'athens',
    coins: 60,
    economyTrack: 5,
    cultureTrack: 5,
    militaryTrack: 5,
    taxTrack: 4,
    gloryTrack: 4,
    troopTrack: 10,
    citizenTrack: 12,
    philosophyTokens: 20,
    knowledgeTokens: makeKnowledgeTokens(),
    handCards: [],
    playedCards: [],
    developmentLevel: 0,
    actionSlots: actionSlot(actionType),
  }, state);

  return {
    playerId,
    state: {
      ...state,
      currentPhase: 'ACTIONS',
      roundNumber: 5,
      currentEvent: null,
      centralBoardTokens: makeBoardTokens(),
      politicsDeck: ALL_POLITICS_CARDS.filter(card =>
        !configured.handCards.some(hand => hand.id === card.id)
        && !configured.playedCards.some(played => played.id === card.id)),
      players: state.players.map((player, index) => index === 0
        ? configured
        : {
            ...player,
            cityId: 'sparta',
            militaryTrack: 6,
            troopTrack: 8,
            knowledgeTokens: makeKnowledgeTokens(),
          }),
      pendingDecisions: [pending(playerId, 'RESOLVE_ACTION')],
    },
  };
}

describe('live solver rule-content coverage', () => {
  it('generates at least one valid politics candidate for every politics card', () => {
    for (const card of ALL_POLITICS_CARDS) {
      const playedCards = card.id === 'ostracism'
        ? [ALL_POLITICS_CARDS.find(c => c.id === 'gifts-from-the-west')!, ALL_POLITICS_CARDS.find(c => c.id === 'bank')!]
        : [];
      const { state, playerId } = prepareActionState('POLITICS', player => ({
        ...player,
        handCards: [card],
        playedCards,
      }));

      const candidates = __liveSolverInternals.enumerateCandidates(state, playerId, 'RESOLVE_ACTION', playerId);
      const matching = candidates.filter(candidate =>
        candidate.message.type === 'RESOLVE_ACTION'
        && candidate.message.actionType === 'POLITICS'
        && candidate.message.choices.targetCardId === card.id);

      expect(matching.length, card.id).toBeGreaterThan(0);
      expect(matching.some(candidate => __liveSolverInternals.applyMessage(state, playerId, candidate.message) !== null), card.id).toBe(true);

      if (card.id === 'scholarly-welcome') {
        const colors = new Set(matching.map(candidate =>
          candidate.message.type === 'RESOLVE_ACTION' ? candidate.message.choices.scholarlyWelcomeColor : null));
        expect(colors).toEqual(new Set(['GREEN', 'BLUE', 'RED']));
      }

      if (card.id === 'ostracism') {
        const returned = new Set(matching.map(candidate =>
          candidate.message.type === 'RESOLVE_ACTION' ? candidate.message.choices.ostracismReturnCardId : null));
        expect(returned).toEqual(new Set(playedCards.map(played => played.id)));
      }
    }
  });

  it('generates valid development candidates for every city development', () => {
    for (const city of ALL_CITIES) {
      for (const development of city.developments) {
        const { state, playerId } = prepareActionState('DEVELOPMENT', player => ({
          ...player,
          cityId: city.id,
          developmentLevel: development.level - 1,
          handCards: [ALL_POLITICS_CARDS.find(card => card.id === 'gifts-from-the-west') as PoliticsCard],
        }));

        const candidates = __liveSolverInternals.enumerateCandidates(state, playerId, 'RESOLVE_ACTION', playerId);
        const matching = candidates.filter(candidate =>
          candidate.message.type === 'RESOLVE_ACTION'
          && candidate.message.actionType === 'DEVELOPMENT');

        expect(matching.length, development.id).toBeGreaterThan(0);
        expect(matching.some(candidate => __liveSolverInternals.applyMessage(state, playerId, candidate.message) !== null), development.id).toBe(true);

        if (development.id === 'miletus-dev-2') {
          const choices = new Set(matching.map(candidate =>
            candidate.message.type === 'RESOLVE_ACTION'
              ? candidate.message.choices.devTrackChoices?.join(',')
              : null));
          expect(choices).toEqual(new Set(['ECONOMY,CULTURE', 'ECONOMY,MILITARY', 'CULTURE,MILITARY']));
        }

        if (development.id === 'argos-dev-2') {
          const rewards = new Set(matching.map(candidate =>
            candidate.message.type === 'RESOLVE_ACTION'
              ? candidate.message.choices.argosDevReward
              : null));
          expect(rewards).toEqual(new Set(['vp', 'coins', 'citizens', 'troops']));
        }

        if (development.id === 'sparta-dev-3') {
          expect(matching.some(candidate =>
            candidate.message.type === 'RESOLVE_ACTION'
            && (candidate.message.choices.spartaMilitaryTokenIds?.length ?? 0) === 2), development.id).toBe(true);
        }
      }
    }
  });

  it('generates valid candidates for every interactive event decision type', () => {
    const eventCases: DecisionType[] = [
      'PROSPERITY_POLITICS',
      'ORACLE_CHOOSE_TOKEN',
      'MILITARY_VICTORY_PROGRESS',
      'RISE_OF_PERSIA_PROGRESS',
      'THIRTY_TYRANTS_DISCARD',
      'CONQUEST_ACTION',
    ];

    for (const decisionType of eventCases) {
      const state = baseState();
      const playerId = state.players[0].playerId;
      const player = {
        ...state.players[0],
        cityId: 'miletus',
        coins: 60,
        economyTrack: 5,
        cultureTrack: 5,
        militaryTrack: 5,
        taxTrack: 4,
        gloryTrack: 4,
        troopTrack: 10,
        citizenTrack: 12,
        philosophyTokens: 20,
        knowledgeTokens: makeKnowledgeTokens(),
        handCards: [
          ALL_POLITICS_CARDS.find(card => card.id === 'gifts-from-the-west')!,
          ALL_POLITICS_CARDS.find(card => card.id === 'bank')!,
        ],
        playedCards: [],
        developmentLevel: 1,
        actionSlots: [null, null, null] as PlayerState['actionSlots'],
      };
      const gloryState: GameState = {
        ...state,
        currentPhase: 'GLORY',
        roundNumber: 5,
        centralBoardTokens: makeBoardTokens(),
        politicsDeck: ALL_POLITICS_CARDS.filter(card => !player.handCards.some(hand => hand.id === card.id)),
        players: state.players.map((p, index) => index === 0 ? player : { ...p, troopTrack: 5, cityId: 'argos' }),
        pendingDecisions: [pending(playerId, decisionType)],
      };

      const candidates = __liveSolverInternals.enumerateCandidates(gloryState, playerId, decisionType, playerId);
      expect(candidates.length, decisionType).toBeGreaterThan(0);
      expect(candidates.some(candidate => __liveSolverInternals.applyMessage(gloryState, playerId, candidate.message) !== null), decisionType).toBe(true);
    }
  });

  it('models Thebes dev-2 as an activatable development', () => {
    const state = baseState();
    const playerId = state.players[0].playerId;
    const player = {
      ...state.players[0],
      cityId: 'thebes',
      developmentLevel: 2,
      coins: 0,
      victoryPoints: 0,
      gloryTrack: 2,
      knowledgeTokens: [],
    };
    const testState = {
      ...state,
      players: state.players.map((p, index) => index === 0 ? player : p),
    };

    const activation = __liveSolverInternals.chooseBestActivation(testState);
    expect(activation?.candidate.message).toEqual({ type: 'ACTIVATE_DEV', devId: 'thebes-dev-2' });

    const applied = __liveSolverInternals.applyMessage(testState, playerId, activation!.candidate.message);
    const updated = applied?.players.find(p => p.playerId === playerId);
    expect(updated?.gloryTrack).toBe(1);
    expect(updated?.coins).toBe(2);
    expect(updated?.victoryPoints).toBe(4);
  });
});
