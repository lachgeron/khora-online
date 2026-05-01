/**
 * GloryPhaseManager — handles the Glory phase (Phase F / Event Resolution).
 *
 * Evaluates the current event card's glory condition for each player.
 * Players who meet the condition gain 2 VP.
 *
 * Interactive event handling:
 * - Prosperity: highest troops get a politics action
 * - Oracle of Delphi: players with >1 token choose which to lose
 * - Military Victory: highest troops choose a track to progress at -2 cost
 * - Rise of Persia: all players may pay discounted cost to progress military
 * - Thirty Tyrants: lowest troops choose 2 cards to discard
 * - Conquest of the Persians: if Persepolis explored, all take a non-military action
 */

import type { ClientMessage, GameState, Result, GameError, ActionChoices, ProgressTrackType } from '@khora/shared';
import type { PhaseManager } from './omen-phase';
import { advanceTrack, subtractCoins } from '../resources';
import { applyEffectToAllPlayers } from '../effects';
import { applyEventEffect, getHighestTroops, getLowestTroops } from '../event-handlers';
import { appendLogEntry, logPlayerDiff } from '../game-log';
import { applyOngoingEffects } from '../card-handlers';
import { applyOngoingDevEffects } from '../city-dev-handlers';
import { PoliticsResolver } from '../actions/politics-resolver';
import { PhilosophyResolver } from '../actions/philosophy-resolver';
import { LegislationResolver } from '../actions/legislation-resolver';
import { CultureResolver } from '../actions/culture-resolver';
import { TradeResolver } from '../actions/trade-resolver';
import { DevelopmentResolver } from '../actions/development-resolver';

const ECONOMY_COSTS: Record<number, number> = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 };
const CULTURE_COSTS: Record<number, number> = { 1: 1, 2: 4, 3: 6, 4: 6, 5: 7, 6: 7 };
const MILITARY_COSTS: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9 };
const TRACK_COST_MAP: Record<string, Record<number, number>> = {
  ECONOMY: ECONOMY_COSTS,
  CULTURE: CULTURE_COSTS,
  MILITARY: MILITARY_COSTS,
};
const MAX_PROGRESS_LEVEL = 7;

function makeDisplayDecision(): GameState['pendingDecisions'] {
  return [{
    playerId: '__display__',
    decisionType: 'PHASE_DISPLAY' as const,
    timeoutAt: Date.now() + 15_000,
    options: null as unknown,
  }];
}

function finishOrDisplay(state: GameState, remaining: GameState['pendingDecisions']): GameState {
  if (remaining.length === 0) {
    return { ...state, pendingDecisions: makeDisplayDecision() };
  }
  return { ...state, pendingDecisions: remaining };
}

const ACTION_RESOLVERS: Record<string, { resolve: (s: GameState, pid: string, c: ActionChoices) => Result<GameState, GameError> }> = {
  PHILOSOPHY: new PhilosophyResolver(),
  LEGISLATION: new LegislationResolver(),
  CULTURE: new CultureResolver(),
  TRADE: new TradeResolver(),
  POLITICS: new PoliticsResolver(),
  DEVELOPMENT: new DevelopmentResolver(),
};

export class GloryPhaseManager implements PhaseManager {
  private readonly politicsResolver = new PoliticsResolver();

  onEnter(state: GameState): GameState {
    if (!state.currentEvent) return state;

    const roundNumber = state.roundNumber;
    const eventCard = state.currentEvent;
    let s = state;

    // Step 1: Apply event effects
    if (eventCard.immediateEffect && !eventCard.triggerDuringDice) {
      s = applyEffectToAllPlayers(s, eventCard.immediateEffect);
    }
    s = applyEventEffect(s, eventCard.id);
    s = appendLogEntry(s, { roundNumber, phase: 'GLORY', playerId: null, action: `Event resolved: ${eventCard.name}`, details: { eventId: eventCard.id } });

    // Log event effect changes
    for (const before of state.players) {
      const after = s.players.find(pl => pl.playerId === before.playerId);
      if (after) {
        s = logPlayerDiff(s, before, after, { roundNumber, phase: 'GLORY', source: eventCard.name });
      }
    }

    // Step 2: Interactive event decisions

    // Oracle of Delphi: auto-resolve players with exactly 1 token before building decisions
    if (eventCard.id === 'oracle-of-delphi') {
      for (const p of s.players.filter(pl => pl.isConnected && !pl.hasFlagged && pl.knowledgeTokens.length === 1)) {
        const lostToken = p.knowledgeTokens[0];
        s = { ...s, players: s.players.map(pl => pl.playerId === p.playerId ? { ...pl, knowledgeTokens: [], philosophyTokens: pl.philosophyTokens + 2 } : pl) };
        s = appendLogEntry(s, { roundNumber, phase: 'GLORY', playerId: p.playerId, action: `Oracle of Delphi: lost ${lostToken.color} token, gained 2 scrolls`, details: { lostTokenId: lostToken.id } });
      }
    }

    const decisions = this.buildEventDecisions(s, eventCard.id);
    if (decisions.length > 0) {
      return { ...s, pendingDecisions: decisions };
    }

    return { ...s, pendingDecisions: makeDisplayDecision() };
  }

  private buildEventDecisions(state: GameState, eventId: string): GameState['pendingDecisions'] {
    const now = Date.now();

    switch (eventId) {
      case 'prosperity': {
        const eligible = getHighestTroops(state).filter(p => p.handCards.some(c => p.coins >= c.cost));
        return eligible.map(p => ({ playerId: p.playerId, decisionType: 'PROSPERITY_POLITICS' as const, timeoutAt: now + 60_000, options: null as unknown }));
      }

      case 'oracle-of-delphi': {
        // Auto-resolve players with exactly 1 token in onEnter, return decisions for >1
        // (already handled in onEnter before calling this)
        const needsChoice = state.players.filter(p => p.isConnected && !p.hasFlagged && p.knowledgeTokens.length > 1);
        return needsChoice.map(p => ({ playerId: p.playerId, decisionType: 'ORACLE_CHOOSE_TOKEN' as const, timeoutAt: now + 30_000, options: null as unknown }));
      }

      case 'military-victory': {
        const eligible = getHighestTroops(state);
        return eligible.map(p => ({ playerId: p.playerId, decisionType: 'MILITARY_VICTORY_PROGRESS' as const, timeoutAt: now + 30_000, options: null as unknown }));
      }

      case 'rise-of-persia': {
        const eligible = state.players.filter(p => p.isConnected && !p.hasFlagged);
        return eligible.map(p => ({ playerId: p.playerId, decisionType: 'RISE_OF_PERSIA_PROGRESS' as const, timeoutAt: now + 30_000, options: null as unknown }));
      }

      case 'thirty-tyrants': {
        const lowest = getLowestTroops(state).filter(p => p.handCards.length > 0);
        return lowest.map(p => ({ playerId: p.playerId, decisionType: 'THIRTY_TYRANTS_DISCARD' as const, timeoutAt: now + 30_000, options: null as unknown }));
      }

      case 'conquest-of-persians': {
        const persepolisExplored = state.centralBoardTokens.some(t => t.isPersepolis && t.explored);
        if (!persepolisExplored) return [];
        const eligible = state.players.filter(p => p.isConnected && !p.hasFlagged);
        return eligible.map(p => ({ playerId: p.playerId, decisionType: 'CONQUEST_ACTION' as const, timeoutAt: now + 60_000, options: null as unknown }));
      }

      default:
        return [];
    }
  }

  handleDecision(state: GameState, playerId: string, decision: ClientMessage): Result<GameState, GameError> {
    const pending = state.pendingDecisions.find(d => d.playerId === playerId);
    if (!pending) {
      return { ok: false, error: { code: 'NOT_YOUR_TURN', message: 'No pending decision for you' } };
    }

    // Universal skip
    if (decision.type === 'SKIP_PHASE') {
      return this.handleSkip(state, playerId, pending.decisionType);
    }

    switch (pending.decisionType) {
      case 'ORACLE_CHOOSE_TOKEN':
        return this.handleOracleToken(state, playerId, decision);
      case 'PROSPERITY_POLITICS':
        return this.handleProsperityPolitics(state, playerId, decision);
      case 'MILITARY_VICTORY_PROGRESS':
        return this.handleMilitaryVictoryProgress(state, playerId, decision);
      case 'RISE_OF_PERSIA_PROGRESS':
        return this.handleRiseOfPersiaProgress(state, playerId, decision);
      case 'THIRTY_TYRANTS_DISCARD':
        return this.handleThirtyTyrantsDiscard(state, playerId, decision);
      case 'CONQUEST_ACTION':
        return this.handleConquestAction(state, playerId, decision);
      default:
        return { ok: false, error: { code: 'WRONG_PHASE', message: 'No interactive decision expected' } };
    }
  }

  private handleSkip(state: GameState, playerId: string, decisionType: string): Result<GameState, GameError> {
    let s = state;
    const remaining = s.pendingDecisions.filter(d => d.playerId !== playerId);

    // Thirty Tyrants skip: auto-discard last 2 cards to bottom of deck
    if (decisionType === 'THIRTY_TYRANTS_DISCARD') {
      const player = s.players.find(p => p.playerId === playerId);
      if (player && player.handCards.length > 0) {
        const toDiscard = Math.min(2, player.handCards.length);
        const discardedCards = player.handCards.slice(player.handCards.length - toDiscard);
        s = { ...s, players: s.players.map(p => p.playerId === playerId ? { ...p, handCards: p.handCards.slice(0, p.handCards.length - toDiscard) } : p), politicsDeck: [...s.politicsDeck, ...discardedCards] };
        s = appendLogEntry(s, { roundNumber: s.roundNumber, phase: 'GLORY', playerId, action: `Thirty Tyrants: discarded ${toDiscard} cards (auto)`, details: {} });
      }
    }

    // Oracle skip: auto-lose last token
    if (decisionType === 'ORACLE_CHOOSE_TOKEN') {
      const player = s.players.find(p => p.playerId === playerId);
      if (player && player.knowledgeTokens.length > 0) {
        const lostToken = player.knowledgeTokens[player.knowledgeTokens.length - 1];
        s = { ...s, players: s.players.map(p => p.playerId === playerId ? { ...p, knowledgeTokens: p.knowledgeTokens.slice(0, -1), philosophyTokens: p.philosophyTokens + 2 } : p) };
        s = appendLogEntry(s, { roundNumber: s.roundNumber, phase: 'GLORY', playerId, action: `Oracle of Delphi: lost ${lostToken.color} token (auto), gained 2 scrolls`, details: {} });
      }
    }

    return { ok: true, value: finishOrDisplay(s, remaining) };
  }

  // --- Oracle of Delphi ---
  private handleOracleToken(state: GameState, playerId: string, decision: ClientMessage): Result<GameState, GameError> {
    if (decision.type !== 'CHOOSE_TOKEN') {
      return { ok: false, error: { code: 'INVALID_MESSAGE', message: 'Expected CHOOSE_TOKEN' } };
    }
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };

    const tokenIdx = player.knowledgeTokens.findIndex(t => t.id === decision.tokenId);
    if (tokenIdx === -1) return { ok: false, error: { code: 'INVALID_DECISION', message: 'Token not found' } };

    const lostToken = player.knowledgeTokens[tokenIdx];
    const newTokens = [...player.knowledgeTokens];
    newTokens.splice(tokenIdx, 1);

    let s: GameState = { ...state, players: state.players.map(p => p.playerId === playerId ? { ...p, knowledgeTokens: newTokens, philosophyTokens: p.philosophyTokens + 2 } : p) };
    s = appendLogEntry(s, { roundNumber: state.roundNumber, phase: 'GLORY', playerId, action: `Oracle of Delphi: lost ${lostToken.color} token, gained 2 scrolls`, details: { lostTokenId: lostToken.id } });
    return { ok: true, value: finishOrDisplay(s, s.pendingDecisions.filter(d => d.playerId !== playerId)) };
  }

  // --- Prosperity ---
  private handleProsperityPolitics(state: GameState, playerId: string, decision: ClientMessage): Result<GameState, GameError> {
    if (decision.type !== 'RESOLVE_ACTION' || decision.actionType !== 'POLITICS') {
      return { ok: false, error: { code: 'INVALID_MESSAGE', message: 'Expected RESOLVE_ACTION with POLITICS' } };
    }
    const result = this.politicsResolver.resolve(state, playerId, decision.choices);
    if (!result.ok) return result;

    // Apply ongoing card effects triggered by POLITICS action
    let s = applyOngoingEffects(result.value, playerId, { type: 'ON_ACTION', actionType: 'POLITICS' });

    // Apply ongoing city development effects triggered by POLITICS action (e.g. Athens dev-2/3)
    s = applyOngoingDevEffects(s, playerId, 'POLITICS');

    // Log with card details
    const playerBefore = state.players.find(p => p.playerId === playerId);
    const logDetails: Record<string, unknown> = { cardId: decision.choices.targetCardId };
    let actionLabel = 'Played a politics card via Prosperity';
    if (playerBefore) {
      const playedCard = playerBefore.handCards.find(c => c.id === decision.choices.targetCardId);
      if (playedCard) {
        actionLabel = `Prosperity: played ${playedCard.name}`;
        logDetails.cardName = playedCard.name;
        logDetails.cardType = playedCard.type;
        logDetails.cardDescription = playedCard.description;
        logDetails.cardCost = playedCard.cost;
        logDetails.cardKnowledgeRequirement = playedCard.knowledgeRequirement;
      }
    }

    const playerAfter = s.players.find(p => p.playerId === playerId);
    s = appendLogEntry(s, { roundNumber: state.roundNumber, phase: 'GLORY', playerId, action: actionLabel, details: logDetails });
    if (playerBefore && playerAfter) {
      s = logPlayerDiff(s, playerBefore, playerAfter, { roundNumber: state.roundNumber, phase: 'GLORY', source: 'Prosperity:POLITICS' });
    }

    return { ok: true, value: finishOrDisplay(s, s.pendingDecisions.filter(d => d.playerId !== playerId)) };
  }

  // --- Military Victory: choose track, pay (cost - 2) ---
  private handleMilitaryVictoryProgress(state: GameState, playerId: string, decision: ClientMessage): Result<GameState, GameError> {
    if (decision.type !== 'EVENT_PROGRESS_TRACK') {
      return { ok: false, error: { code: 'INVALID_MESSAGE', message: 'Expected EVENT_PROGRESS_TRACK' } };
    }
    const track = decision.track as ProgressTrackType;
    if (!['ECONOMY', 'CULTURE', 'MILITARY'].includes(track)) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'Must choose ECONOMY, CULTURE, or MILITARY' } };
    }

    const playerIdx = state.players.findIndex(p => p.playerId === playerId);
    if (playerIdx === -1) return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };

    let player = state.players[playerIdx];
    const currentLevel = track === 'ECONOMY' ? player.economyTrack : track === 'CULTURE' ? player.cultureTrack : player.militaryTrack;

    if (currentLevel >= MAX_PROGRESS_LEVEL) {
      return { ok: false, error: { code: 'TRACK_MAX_REACHED', message: `${track} track is already at maximum level` } };
    }

    const trackCosts = TRACK_COST_MAP[track] ?? {};
    const baseCost = trackCosts[currentLevel] ?? 99;
    const discountedCost = Math.max(0, baseCost - 2);

    if (discountedCost > 0) {
      const costResult = subtractCoins(player, discountedCost);
      if (!costResult.ok) return { ok: false, error: costResult.error };
      player = costResult.value;
    }
    player = advanceTrack(player, track, 1);

    const players = [...state.players];
    players[playerIdx] = player;
    let s: GameState = { ...state, players };
    s = appendLogEntry(s, { roundNumber: state.roundNumber, phase: 'GLORY', playerId, action: `Military Victory: advanced ${track} (paid ${discountedCost})`, details: { track, cost: discountedCost } });
    return { ok: true, value: finishOrDisplay(s, s.pendingDecisions.filter(d => d.playerId !== playerId)) };
  }

  // --- Rise of Persia: pay (cost - 2) to progress military ---
  private handleRiseOfPersiaProgress(state: GameState, playerId: string, decision: ClientMessage): Result<GameState, GameError> {
    if (decision.type !== 'EVENT_PROGRESS_TRACK') {
      return { ok: false, error: { code: 'INVALID_MESSAGE', message: 'Expected EVENT_PROGRESS_TRACK' } };
    }
    if (decision.track !== 'MILITARY') {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'Rise of Persia only allows MILITARY track' } };
    }

    const playerIdx = state.players.findIndex(p => p.playerId === playerId);
    if (playerIdx === -1) return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };

    let player = state.players[playerIdx];

    if (player.militaryTrack >= MAX_PROGRESS_LEVEL) {
      return { ok: false, error: { code: 'TRACK_MAX_REACHED', message: 'MILITARY track is already at maximum level' } };
    }

    const baseCost = (TRACK_COST_MAP['MILITARY'] ?? {})[player.militaryTrack] ?? 99;
    const discountedCost = Math.max(0, baseCost - 2);

    if (discountedCost > 0) {
      const costResult = subtractCoins(player, discountedCost);
      if (!costResult.ok) return { ok: false, error: costResult.error };
      player = costResult.value;
    }
    player = advanceTrack(player, 'MILITARY', 1);

    const players = [...state.players];
    players[playerIdx] = player;
    let s: GameState = { ...state, players };
    s = appendLogEntry(s, { roundNumber: state.roundNumber, phase: 'GLORY', playerId, action: `Rise of Persia: advanced MILITARY (paid ${discountedCost})`, details: { cost: discountedCost } });
    return { ok: true, value: finishOrDisplay(s, s.pendingDecisions.filter(d => d.playerId !== playerId)) };
  }

  // --- Thirty Tyrants: choose 2 cards to discard ---
  private handleThirtyTyrantsDiscard(state: GameState, playerId: string, decision: ClientMessage): Result<GameState, GameError> {
    if (decision.type !== 'DISCARD_CARDS') {
      return { ok: false, error: { code: 'INVALID_MESSAGE', message: 'Expected DISCARD_CARDS' } };
    }
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };

    const toDiscard = Math.min(2, player.handCards.length);
    if (decision.cardIds.length !== toDiscard) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: `Must discard exactly ${toDiscard} card(s)` } };
    }

    // Validate all card IDs exist in hand
    const discardSet = new Set(decision.cardIds);
    for (const cid of discardSet) {
      if (!player.handCards.some(c => c.id === cid)) {
        return { ok: false, error: { code: 'CARD_NOT_IN_HAND', message: `Card ${cid} not in hand` } };
      }
    }

    const discardedCards = player.handCards.filter(c => discardSet.has(c.id));
    const newHand = player.handCards.filter(c => !discardSet.has(c.id));
    let s: GameState = {
      ...state,
      players: state.players.map(p => p.playerId === playerId ? { ...p, handCards: newHand } : p),
      politicsDeck: [...state.politicsDeck, ...discardedCards],
    };
    s = appendLogEntry(s, { roundNumber: state.roundNumber, phase: 'GLORY', playerId, action: `Thirty Tyrants: discarded ${toDiscard} cards`, details: { cardIds: decision.cardIds } });
    return { ok: true, value: finishOrDisplay(s, s.pendingDecisions.filter(d => d.playerId !== playerId)) };
  }

  // --- Conquest of the Persians: take any non-military action ---
  private handleConquestAction(state: GameState, playerId: string, decision: ClientMessage): Result<GameState, GameError> {
    if (decision.type !== 'RESOLVE_ACTION') {
      return { ok: false, error: { code: 'INVALID_MESSAGE', message: 'Expected RESOLVE_ACTION' } };
    }
    if (decision.actionType === 'MILITARY') {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'Cannot take Military action during Conquest of the Persians' } };
    }

    const resolver = ACTION_RESOLVERS[decision.actionType];
    if (!resolver) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: `Unknown action type: ${decision.actionType}` } };
    }

    try {
      const result = resolver.resolve(state, playerId, decision.choices);
      if (!result.ok) return result;

      // Apply ongoing card effects triggered by this action (e.g. Stoa Poikile on CULTURE)
      let s = applyOngoingEffects(result.value, playerId, { type: 'ON_ACTION', actionType: decision.actionType });

      // Apply ongoing city development effects triggered by this action (e.g. Athens dev-2 on POLITICS)
      s = applyOngoingDevEffects(s, playerId, decision.actionType);

      // Log the conquest action with detailed changes
      const playerBefore = state.players.find(p => p.playerId === playerId);
      const playerAfter = s.players.find(p => p.playerId === playerId);

      let actionLabel = `Conquest: took ${decision.actionType} action`;
      const logDetails: Record<string, unknown> = { actionType: decision.actionType };

      // For POLITICS actions, include the card name
      if (decision.actionType === 'POLITICS' && decision.choices.targetCardId && playerBefore) {
        const playedCard = playerBefore.handCards.find(c => c.id === decision.choices.targetCardId);
        if (playedCard) {
          actionLabel = `Conquest: played ${playedCard.name}`;
          logDetails.cardId = playedCard.id;
          logDetails.cardName = playedCard.name;
          logDetails.cardType = playedCard.type;
          logDetails.cardDescription = playedCard.description;
          logDetails.cardCost = playedCard.cost;
          logDetails.cardKnowledgeRequirement = playedCard.knowledgeRequirement;
        }
      }

      s = appendLogEntry(s, { roundNumber: state.roundNumber, phase: 'GLORY', playerId, action: actionLabel, details: logDetails });
      if (playerBefore && playerAfter) {
        s = logPlayerDiff(s, playerBefore, playerAfter, { roundNumber: state.roundNumber, phase: 'GLORY', source: `Conquest:${decision.actionType}` });
      }

      return { ok: true, value: finishOrDisplay(s, s.pendingDecisions.filter(d => d.playerId !== playerId)) };
    } catch (err) {
      console.error(`[GloryPhase] Conquest action ${decision.actionType} threw:`, err);
      // Gracefully skip if the resolver crashes
      const remaining = state.pendingDecisions.filter(d => d.playerId !== playerId);
      return { ok: true, value: finishOrDisplay(state, remaining) };
    }
  }

  isComplete(state: GameState): boolean {
    return state.pendingDecisions.length === 0;
  }

  autoResolve(state: GameState, playerId: string): GameState {
    if (playerId === '__display__') {
      return { ...state, pendingDecisions: [] };
    }

    const pending = state.pendingDecisions.find(d => d.playerId === playerId);

    // Oracle: auto-lose last token
    if (pending?.decisionType === 'ORACLE_CHOOSE_TOKEN') {
      const player = state.players.find(p => p.playerId === playerId);
      if (player && player.knowledgeTokens.length > 0) {
        let s: GameState = { ...state, players: state.players.map(p => p.playerId === playerId ? { ...p, knowledgeTokens: p.knowledgeTokens.slice(0, -1), philosophyTokens: p.philosophyTokens + 2 } : p) };
        return finishOrDisplay(s, s.pendingDecisions.filter(d => d.playerId !== playerId));
      }
    }

    // Thirty Tyrants: auto-discard last 2 cards to bottom of deck
    if (pending?.decisionType === 'THIRTY_TYRANTS_DISCARD') {
      const player = state.players.find(p => p.playerId === playerId);
      if (player && player.handCards.length > 0) {
        const toDiscard = Math.min(2, player.handCards.length);
        const discardedCards = player.handCards.slice(player.handCards.length - toDiscard);
        let s: GameState = { ...state, players: state.players.map(p => p.playerId === playerId ? { ...p, handCards: p.handCards.slice(0, p.handCards.length - toDiscard) } : p), politicsDeck: [...state.politicsDeck, ...discardedCards] };
        return finishOrDisplay(s, s.pendingDecisions.filter(d => d.playerId !== playerId));
      }
    }

    // Everything else: just skip
    const remaining = state.pendingDecisions.filter(d => d.playerId !== playerId);
    return finishOrDisplay(state, remaining);
  }
}
