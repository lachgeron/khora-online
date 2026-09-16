import { describe, expect, it } from 'vitest';
import type { ActionType, ClientMessage, GameState, PlayerState, Result } from '@khora/shared';
import { ALL_POLITICS_CARDS, EXPANSION_POLITICS_CARDS, buildPoliticsDeck } from './game-data';
import { makeTestGameState, makeTestPlayer } from './test-helpers';
import { LobbyManager } from './lobby';
import { GameEngine } from './game-engine';
import { DraftPoliticsPhaseManager } from './phases/draft-politics-phase';
import { PickBanDraftPhaseManager } from './phases/pick-ban-draft-phase';
import { TaxationPhaseManager } from './phases/taxation-phase';
import { ActionPhaseManager } from './phases/action-phase';
import { PoliticsResolver } from './actions/politics-resolver';
import { LegislationResolver } from './actions/legislation-resolver';
import { applyOngoingEffects } from './card-handlers';
import { prepareExpansionChoices } from './expansion-choices';
import { resolveExpansionChoice } from './expansion-resolver';
import { calculateFinalScores } from './scoring-engine';
import { advanceTrack } from './resources';
import { createMinorToken } from './knowledge-tokens';
import { getStateForPlayer } from './visibility';
import { serializeGameState, deserializeGameState } from './serialization';
import { DEV_IMMEDIATE_HANDLERS } from './city-dev-handlers';

const card = (id: string) => [...ALL_POLITICS_CARDS, ...EXPANSION_POLITICS_CARDS].find(c => c.id === id)!;
const slot = (actionType: ActionType) => ({ actionType, assignedDie: 6, citizenCost: 0, resolved: false });
function ok<T>(result: Result<T, unknown>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}
function richPlayer(overrides: Partial<PlayerState> = {}) {
  return makeTestPlayer({ coins: 20, philosophyTokens: 10,
    knowledgeTokens: ['GREEN', 'BLUE', 'RED'].flatMap(color => Array.from({ length: 3 }, () => createMinorToken(color as 'GREEN' | 'BLUE' | 'RED'))), ...overrides });
}
function play(id: string, overrides: Partial<PlayerState> = {}, deck = ALL_POLITICS_CARDS): GameState {
  const state = makeTestGameState({ politicsDeck: deck, players: [richPlayer({ handCards: [card(id)], ...overrides }), makeTestPlayer({ playerId: 'player-2' })] });
  return ok(new PoliticsResolver().resolve(state, 'player-1', { targetCardId: id }));
}
function choose(state: GameState, message: Omit<Extract<ClientMessage, { type: 'RESOLVE_EXPANSION' }>, 'type'>) {
  return ok(resolveExpansionChoice(state, 'player-1', { type: 'RESOLVE_EXPANSION', ...message }));
}
function engineFor(state: GameState) {
  const engine = new GameEngine(state.draftMode);
  engine.getStateMachine().currentPhase = state.currentPhase;
  engine.getStateMachine().roundNumber = state.roundNumber;
  return engine;
}

describe('expansion setup', () => {
  it('defaults off and adds exactly 21 unique cards only when enabled', () => {
    expect(new LobbyManager().createLobby('Host').includeExpansionCards).toBe(false);
    expect(buildPoliticsDeck()).toHaveLength(40);
    const deck = buildPoliticsDeck(true);
    expect(deck).toHaveLength(61);
    expect(new Set(deck.map(c => c.id)).size).toBe(61);
    expect(deck.filter(c => c.expansion)).toHaveLength(21);
    expect(EXPANSION_POLITICS_CARDS.filter(c => c.type === 'END_GAME')).toHaveLength(4);
    expect(EXPANSION_POLITICS_CARDS.filter(c => c.type === 'ONGOING')).toHaveLength(9);
    expect(EXPANSION_POLITICS_CARDS.filter(c => c.type === 'IMMEDIATE')).toHaveLength(8);
  });
  it.each([false, true])('uses the selected deck in both draft modes (expansion=%s)', enabled => {
    const state = makeTestGameState({ politicsDeck: buildPoliticsDeck(enabled) });
    const standard = new DraftPoliticsPhaseManager().onEnter(state);
    const cards = [...standard.politicsDeck, ...Object.values(standard.draftState!.politicsDraft!.packs).flat()];
    expect(cards.filter(c => c.expansion)).toHaveLength(enabled ? 21 : 0);
    const pickBan = new PickBanDraftPhaseManager().onEnter(state);
    expect(pickBan.draftState!.pickBanDraft!.allCards.filter(c => c.expansion)).toHaveLength(enabled ? 21 : 0);
  });
});

describe('expansion immediate effects', () => {
  it.each([
    ['the-seven-wonders', { coins: 13, victoryPoints: 12 }],
    ['tracian-mercenaries', { coins: 18, troopTrack: 3, victoryPoints: 3 }],
    ['great-sacrifice', { coins: 17, gloryTrack: 1 }],
  ])('%s pays its cost and applies its reward', (id, result) => {
    expect(play(id as string).players[0]).toMatchObject(result);
  });
  it('Helots exchanges all Glory and Trade Agreement rewards opponents', () => {
    expect(play('helots', { gloryTrack: 4 }).players[0]).toMatchObject({ gloryTrack: 0, coins: 32 });
    const state = play('trade-agreement');
    expect(state.players.map(p => p.coins)).toEqual([25, 6]);
  });
  it('Heraclides requires an owned minor token and cannot sacrifice a major', () => {
    const state = play('heraclides');
    expect(resolveExpansionChoice(state, 'player-2', { type: 'RESOLVE_EXPANSION', value: state.players[0].knowledgeTokens[0].id }).ok).toBe(false);
    expect(resolveExpansionChoice(state, 'player-1', { type: 'RESOLVE_EXPANSION', value: 'missing' }).ok).toBe(false);
    const next = choose(state, { value: state.players[0].knowledgeTokens[0].id });
    expect(next.players[0].knowledgeTokens).toHaveLength(8);
    expect(next.players[0].victoryPoints).toBe(6);
    const majorState = play('heraclides', { knowledgeTokens: [{ ...createMinorToken('BLUE'), tokenType: 'MAJOR' }] });
    expect(majorState.expansionChoices).toBeUndefined();
    expect(majorState.players[0].victoryPoints).toBe(0);
  });
  it('Demagorgy validates spending and caps citizens', () => {
    const state = play('demagorgy', { citizenTrack: 12 });
    for (const amount of [-1, 0.5, 4, NaN]) expect(resolveExpansionChoice(state, 'player-1', { type: 'RESOLVE_EXPANSION', amount }).ok).toBe(false);
    expect(choose(state, { amount: 3 }).players[0]).toMatchObject({ coins: 17, citizenTrack: 15 });
  });
  it('Mausoleum only offers the bottom five and moves one card exactly once', () => {
    const state = play('mausoleum-of-halikarnassos');
    expect(state.expansionChoices![0].cards).toEqual(ALL_POLITICS_CARDS.slice(-5));
    expect(resolveExpansionChoice(state, 'player-1', { type: 'RESOLVE_EXPANSION', value: ALL_POLITICS_CARDS[0].id }).ok).toBe(false);
    const next = choose(state, { value: ALL_POLITICS_CARDS.at(-1)!.id });
    expect(next.players[0].handCards).toEqual([ALL_POLITICS_CARDS.at(-1)]);
    expect(next.politicsDeck).toHaveLength(39);
    expect(next.expansionChoices![0].kind).toBe('POLITICS');
    expect(choose(next, { value: 'skip' }).expansionChoices).toEqual([]);
  });
  it('handles a short or empty Mausoleum deck', () => {
    expect(play('mausoleum-of-halikarnassos', {}, ALL_POLITICS_CARDS.slice(0, 2)).expansionChoices![0].cards).toHaveLength(2);
    expect(play('mausoleum-of-halikarnassos', {}, []).expansionChoices![0].kind).toBe('POLITICS');
  });
});

describe('expansion ongoing effects', () => {
  it('Histories of Herodotus grants a scroll on each Politics action, without an immediate reward', () => {
    let state = play('histories-of-herodotus');
    expect(state.players[0]).toMatchObject({ coins: 18, philosophyTokens: 10 });
    expect(state.players[0].playedCards[0].type).toBe('ONGOING');
    state = applyOngoingEffects(state, 'player-1', { type: 'ON_ACTION', actionType: 'POLITICS' });
    expect(state.players[0].philosophyTokens).toBe(11);
    state = applyOngoingEffects(state, 'player-1', { type: 'ON_ACTION', actionType: 'POLITICS' });
    expect(state.players[0].philosophyTokens).toBe(12);
    state = applyOngoingEffects(state, 'player-1', { type: 'ON_ACTION', actionType: 'CULTURE' });
    expect(state.players[0].philosophyTokens).toBe(12);
  });
  it('grants action bonuses only for the matching action', () => {
    const player = richPlayer({ playedCards: [card('slaves-market'), card('xenophons-memoirs')] });
    const state = makeTestGameState({ players: [player] });
    expect(applyOngoingEffects(state, player.playerId, { type: 'ON_ACTION', actionType: 'MILITARY' }).players[0]).toMatchObject({ coins: 21, troopTrack: 0 });
    expect(applyOngoingEffects(state, player.playerId, { type: 'ON_ACTION', actionType: 'PHILOSOPHY' }).players[0]).toMatchObject({ coins: 20, troopTrack: 2 });
  });
  it('Ecclesia reveals three cards and keeps exactly one, returning the other two to the bottom', () => {
    const player = richPlayer({ playedCards: [card('ecclesia')], actionSlots: [slot('LEGISLATION'), null, null] });
    const state = makeTestGameState({ currentPhase: 'ACTIONS', politicsDeck: ALL_POLITICS_CARDS.slice(0, 4), players: [player] });
    expect(getStateForPlayer(state, player.playerId).private.legislationDraw).toHaveLength(3);
    const next = ok(new LegislationResolver().resolve(state, player.playerId, { targetCardId: state.politicsDeck[2].id }));
    expect(next.players[0].handCards).toEqual([state.politicsDeck[2]]);
    expect(next.politicsDeck.map(c => c.id)).toEqual([state.politicsDeck[3].id, state.politicsDeck[0].id, state.politicsDeck[1].id]);
  });
  it('Enlistment pauses taxation, is optional and cannot be repeated', () => {
    let state = makeTestGameState({ currentPhase: 'TAXATION', players: [richPlayer({ playedCards: [card('enlistment')] })] });
    state = prepareExpansionChoices(new TaxationPhaseManager().onEnter(state));
    const engine = engineFor(state);
    const next = ok(engine.handlePlayerDecision(state, 'player-1', { type: 'RESOLVE_EXPANSION', amount: 1 }));
    expect(next.players[0]).toMatchObject({ citizenTrack: 2, troopTrack: 1 });
    expect(next.pendingDecisions[0].decisionType).toBe('PHASE_DISPLAY');
    expect(engine.handlePlayerDecision(next, 'player-1', { type: 'RESOLVE_EXPANSION', amount: 1 }).ok).toBe(false);
  });
  it('Epidaurus pauses after automatic Culture and resumes the next action once', () => {
    let state = makeTestGameState({ currentPhase: 'ACTIONS', players: [richPlayer({ playedCards: [card('epidaurus')], actionSlots: [slot('CULTURE'), slot('TRADE'), null] })] });
    state = prepareExpansionChoices(new ActionPhaseManager().onEnter(state));
    expect(state.pendingDecisions[0].decisionType).toBe('EXPANSION_CHOICE');
    const next = ok(engineFor(state).handlePlayerDecision(state, 'player-1', { type: 'RESOLVE_EXPANSION', value: 'coin' }));
    expect(next.players[0].coins).toBe(21);
    expect(next.players[0].actionSlots[0]?.resolved).toBe(true);
    expect(next.pendingDecisions[0].options).toEqual({ actionType: 'TRADE' });
  });
  it('Architect charges the extra drachma and the card cost, preserving normal play triggers', () => {
    let state = makeTestGameState({ players: [richPlayer({ handCards: [card('the-seven-wonders')], playedCards: [card('architect'), card('extraordinary-collection')], developmentLevel: 2 })] });
    state = applyOngoingEffects(state, 'player-1', { type: 'ON_ACTION', actionType: 'DEVELOPMENT' });
    const next = choose(state, { choices: { targetCardId: 'the-seven-wonders' } });
    expect(next.players[0]).toMatchObject({ coins: 16, victoryPoints: 15 }); // 20 - 1 - 7 + 2 collection + 2 Athens
    expect(next.players[0].playedCards.some(c => c.id === 'the-seven-wonders')).toBe(true);
  });
  it('Frescoes offers every gained Glory, including milestones at the cap', () => {
    const player = richPlayer({ gloryTrack: 10, militaryTrack: 6, playedCards: [card('frescoes-by-polygnotus')] });
    const gained = advanceTrack(player, 'MILITARY', 1);
    expect(gained.pendingGloryGains).toBe(2);
    const state = prepareExpansionChoices(makeTestGameState({ players: [gained] }));
    expect(choose(state, { amount: 2 }).players[0]).toMatchObject({ gloryTrack: 10, victoryPoints: 6 });
  });
  it('settles new Glory before an Architect card can reset Glory with Helots', () => {
    const player = advanceTrack(richPlayer({ gloryTrack: 0, playedCards: [card('frescoes-by-polygnotus'), card('architect')], handCards: [card('helots')] }), 'GLORY', 2);
    let state = applyOngoingEffects(makeTestGameState({ players: [player] }), 'player-1', { type: 'ON_ACTION', actionType: 'DEVELOPMENT' });
    state = prepareExpansionChoices(state);
    expect(state.expansionChoices![0].kind).toBe('GLORY');
    state = choose(state, { amount: 0 });
    state = choose(state, { choices: { targetCardId: 'helots' } });
    expect(state.players[0]).toMatchObject({ gloryTrack: 0, coins: 25 });
  });
  it('Strategist takes military precedence without resolving other slots early', () => {
    const state = makeTestGameState({ currentPhase: 'ACTIONS', players: [richPlayer({ actionSlots: [slot('MILITARY'), null, null] }), richPlayer({ playerId: 'player-2', playedCards: [card('strategist')], actionSlots: [slot('LEGISLATION'), slot('MILITARY'), null] })] });
    const manager = new ActionPhaseManager();
    const ready = manager.onEnter(state);
    expect(ready.pendingDecisions[0].playerId).toBe('player-2');
    expect(getStateForPlayer(ready, 'player-2').private.nextActionType).toBe('MILITARY');
    const next = ok(manager.handleDecision(ready, 'player-2', { type: 'RESOLVE_ACTION', actionType: 'MILITARY', choices: {} }));
    expect(next.players[1].actionSlots[0]?.resolved).toBe(false);
    expect(next.players[1].actionSlots[1]?.resolved).toBe(true);
    expect(next.pendingDecisions[0].playerId).toBe('player-1');
  });
});

describe('expansion scoring and recovery', () => {
  it('extra military and culture actions also trigger expansion bonuses', () => {
    const military = makeTestGameState({ players: [richPlayer({ cityId: 'sparta', playedCards: [card('slaves-market')] })] });
    expect(DEV_IMMEDIATE_HANDLERS['sparta-dev-3'](military, 'player-1').players[0].coins).toBe(22);
    const culture = makeTestGameState({ players: [richPlayer({ cityId: 'olympia', playedCards: [card('epidaurus')] })] });
    expect(DEV_IMMEDIATE_HANDLERS['olympia-dev-4'](culture, 'player-1').expansionChoices).toHaveLength(3);
  });
  it('scores yellow cards, scrolls, strictly greater Glory and Hades after all other sources', () => {
    const player = richPlayer({ victoryPoints: 19, coins: 4, philosophyTokens: 2, gloryTrack: 3,
      playedCards: ['palestra', 'great-library', 'favour-of-the-gods', 'hades', 'bank', 'the-seven-wonders', 'tracian-mercenaries'].map(card),
      knowledgeTokens: [{ ...createMinorToken('GREEN'), tokenType: 'MAJOR' }] });
    const state = makeTestGameState({ players: [player, makeTestPlayer({ playerId: 'player-2', gloryTrack: 4 }), makeTestPlayer({ playerId: 'player-3', gloryTrack: 3 })] });
    const score = calculateFinalScores(state).rankings.find(p => p.playerId === player.playerId)!;
    // 19 + 8 Palestra + 6 Library + 5 Favour + 2 Bank + 3 Glory = 43, then 4 Hades.
    expect(score.totalPoints).toBe(47);
    expect(score.breakdown.politicsCardPoints).toBe(25);
    expect(calculateFinalScores(deserializeGameState(serializeGameState(state)))).toEqual(calculateFinalScores(state));
  });
  it('only exposes a Mausoleum choice to its owner', () => {
    const state = prepareExpansionChoices(play('mausoleum-of-halikarnassos'));
    expect(getStateForPlayer(state, 'player-1').private.expansionChoice?.cards).toHaveLength(5);
    expect(getStateForPlayer(state, 'player-2').private.expansionChoice).toBeNull();
  });
  it('timeouts decline an optional card effect and restore the phase timer', () => {
    const state = prepareExpansionChoices({ ...play('demagorgy'), currentPhase: 'TAXATION', pendingDecisions: [{ playerId: '__display__', decisionType: 'PHASE_DISPLAY', timeoutAt: Date.now() + 15000, options: null }] });
    const next = engineFor(state).handleTimeout(state, 'player-1');
    expect(next.expansionChoices).toEqual([]);
    expect(next.players[0].coins).toBe(20);
    expect(next.pendingDecisions[0].decisionType).toBe('PHASE_DISPLAY');
  });
  it('flagging the choice owner releases the suspended game', () => {
    const state = prepareExpansionChoices({ ...play('demagorgy'), currentPhase: 'ACTIONS' });
    const next = engineFor(state).handleFlag(state, 'player-1');
    expect(next.players[0].hasFlagged).toBe(true);
    expect(next.expansionChoices).toEqual([]);
    expect(next.pendingDecisions[0].decisionType).toBe('PHASE_DISPLAY');
  });
});
