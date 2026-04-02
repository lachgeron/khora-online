/**
 * ActionPhaseManager — handles the Action phase (Phase D) of each round.
 *
 * Players take turns in turn order. On their turn, a player resolves
 * ALL of their actions in ascending cost order (0–6) before the next
 * player's turn begins. Only the active player may act.
 */

import type { ClientMessage, GameState, Result, GameError, ActionType } from '@khora/shared';
import { ACTION_NUMBERS, ACTION_BY_NUMBER } from '@khora/shared';
import type { PhaseManager } from './omen-phase';
import type { ActionResolver } from '../actions/action-resolver';
import { PhilosophyResolver } from '../actions/philosophy-resolver';
import { LegislationResolver } from '../actions/legislation-resolver';
import { CultureResolver } from '../actions/culture-resolver';
import { TradeResolver } from '../actions/trade-resolver';
import { MilitaryResolver } from '../actions/military-resolver';
import { PoliticsResolver } from '../actions/politics-resolver';
import { DevelopmentResolver } from '../actions/development-resolver';
import { applyOngoingEffects } from '../card-handlers';
import { applyOngoingDevEffects } from '../city-dev-handlers';
import { appendLogEntry, logPlayerDiff } from '../game-log';

/** Per-action timeout durations in milliseconds. */
const ACTION_TIMEOUTS: Record<string, number> = {
  PHILOSOPHY: 10_000,
  LEGISLATION: 30_000,
  CULTURE: 5_000,
  TRADE: 30_000,
  MILITARY: 60_000,
  POLITICS: 60_000,
  DEVELOPMENT: 20_000,
};

/** Actions that cannot be skipped by the player. */
const NO_SKIP_ACTIONS = new Set(['PHILOSOPHY', 'CULTURE', 'TRADE', 'MILITARY']);

export class ActionPhaseManager implements PhaseManager {
  private resolvers: Map<ActionType, ActionResolver> = new Map();

  constructor() {
    const resolvers: ActionResolver[] = [
      new PhilosophyResolver(),
      new LegislationResolver(),
      new CultureResolver(),
      new TradeResolver(),
      new MilitaryResolver(),
      new PoliticsResolver(),
      new DevelopmentResolver(),
    ];
    for (const r of resolvers) {
      this.resolvers.set(r.actionType, r);
    }
  }

  onEnter(state: GameState): GameState {
    return this.buildPendingForActivePlayer(state);
  }

  handleDecision(
    state: GameState,
    playerId: string,
    decision: ClientMessage,
  ): Result<GameState, GameError> {
    if (decision.type === 'SKIP_PHASE') {
      // Only the active player may skip
      const activePlayerId = this.getActivePlayerId(state);
      if (activePlayerId !== playerId) {
        return {
          ok: false,
          error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn to resolve actions.' },
        };
      }
      // Check if the current action can be skipped
      const player = state.players.find(p => p.playerId === playerId);
      if (player) {
        const unresolvedSlots = player.actionSlots
          .filter((s): s is NonNullable<typeof s> => s !== null && !s.resolved);
        const lowestCost = Math.min(...unresolvedSlots.map(s => ACTION_NUMBERS[s.actionType]));
        const nextAction = ACTION_BY_NUMBER[lowestCost];
        if (nextAction && NO_SKIP_ACTIONS.has(nextAction)) {
          return {
            ok: false,
            error: { code: 'INVALID_DECISION', message: `Cannot skip ${nextAction} action.` },
          };
        }
      }
      // Auto-resolve all remaining actions for this player and advance to next player
      let updatedState = this.autoResolvePlayer(state, playerId);
      updatedState = this.buildPendingForActivePlayer(updatedState);
      return { ok: true, value: updatedState };
    }

    if (decision.type !== 'RESOLVE_ACTION') {
      return {
        ok: false,
        error: { code: 'INVALID_MESSAGE', message: 'Expected RESOLVE_ACTION or SKIP_PHASE message' },
      };
    }

    // Only the active player (first in turn order with unresolved actions) may act
    const activePlayerId = this.getActivePlayerId(state);
    if (activePlayerId !== playerId) {
      return {
        ok: false,
        error: { code: 'NOT_YOUR_TURN', message: 'It is not your turn to resolve actions.' },
      };
    }

    const resolver = this.resolvers.get(decision.actionType);
    if (!resolver) {
      return {
        ok: false,
        error: { code: 'INVALID_DECISION', message: `Unknown action type: ${decision.actionType}` },
      };
    }

    // Enforce ascending cost order within the player's own actions
    const player = state.players.find(p => p.playerId === playerId);
    if (player) {
      const unresolvedSlots = player.actionSlots
        .filter((s): s is NonNullable<typeof s> => s !== null && !s.resolved);
      const lowestCost = Math.min(...unresolvedSlots.map(s => ACTION_NUMBERS[s.actionType]));
      if (ACTION_NUMBERS[decision.actionType] !== lowestCost) {
        return {
          ok: false,
          error: {
            code: 'INVALID_DECISION',
            message: `Must resolve actions in ascending cost order. Resolve ${ACTION_BY_NUMBER[lowestCost]} (cost ${lowestCost}) first.`,
          },
        };
      }
    }

    const result = resolver.resolve(state, playerId, decision.choices);
    if (!result.ok) return result;

    // Apply ongoing card effects triggered by this action
    let updatedState = applyOngoingEffects(result.value, playerId, { type: 'ON_ACTION', actionType: decision.actionType });

    // Apply ongoing city development effects triggered by this action
    updatedState = applyOngoingDevEffects(updatedState, playerId, decision.actionType);

    // Log the resolved action with detailed changes
    const playerBefore = state.players.find(p => p.playerId === playerId);
    const playerAfter = updatedState.players.find(p => p.playerId === playerId);
    updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'ACTIONS', playerId, action: `Resolved ${decision.actionType}`, details: { actionType: decision.actionType } });
    if (playerBefore && playerAfter) {
      updatedState = logPlayerDiff(updatedState, playerBefore, playerAfter, { roundNumber: state.roundNumber, phase: 'ACTIONS', source: decision.actionType });
    }

    // Mark the action slot as resolved
    const playerIndex = updatedState.players.findIndex(p => p.playerId === playerId);
    if (playerIndex !== -1) {
      const p = updatedState.players[playerIndex];
      const updatedSlots = p.actionSlots.map(slot => {
        if (slot && slot.actionType === decision.actionType) {
          return { ...slot, resolved: true };
        }
        return slot;
      }) as typeof p.actionSlots;

      const updatedPlayers = [...updatedState.players];
      updatedPlayers[playerIndex] = { ...p, actionSlots: updatedSlots };
      updatedState = { ...updatedState, players: updatedPlayers };
    }

    // Rebuild pending decisions — may advance to next player if this player is done
    updatedState = this.buildPendingForActivePlayer(updatedState);

    return { ok: true, value: updatedState };
  }

  isComplete(state: GameState): boolean {
    return state.players
      .filter(p => p.isConnected)
      .every(p => !this.hasUnresolvedActions(p.actionSlots));
  }

  autoResolve(state: GameState, playerId: string): GameState {
    let updatedState = this.autoResolvePlayer(state, playerId);
    return this.buildPendingForActivePlayer(updatedState);
  }

  /**
   * Resolves all unresolved actions for a player with empty choices
   * and marks them as resolved.
   */
  private autoResolvePlayer(state: GameState, playerId: string): GameState {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) return state;

    let updatedState = state;
    const player = state.players[playerIndex];

    // Resolve all unresolved actions in ascending cost order
    const unresolvedSlots = player.actionSlots
      .filter((s): s is NonNullable<typeof s> => s !== null && !s.resolved)
      .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType]);

    for (const slot of unresolvedSlots) {
      const resolver = this.resolvers.get(slot.actionType);
      if (resolver) {
        const result = resolver.resolve(updatedState, playerId, {});
        if (result.ok) {
          updatedState = result.value;
        }
      }

      // Mark as resolved regardless of success
      const pIdx = updatedState.players.findIndex(p => p.playerId === playerId);
      if (pIdx !== -1) {
        const p = updatedState.players[pIdx];
        const updatedSlots = p.actionSlots.map(s => {
          if (s && s.actionType === slot.actionType) return { ...s, resolved: true };
          return s;
        }) as typeof p.actionSlots;

        const updatedPlayers = [...updatedState.players];
        updatedPlayers[pIdx] = { ...p, actionSlots: updatedSlots };
        updatedState = { ...updatedState, players: updatedPlayers };
      }
    }

    // Return state with this player's actions resolved
    return updatedState;
  }

  private hasUnresolvedActions(
    actionSlots: import('@khora/shared').ActionSlotTuple,
  ): boolean {
    return actionSlots.some(s => s !== null && !s.resolved);
  }

  /**
   * Returns the player ID of the first player in turn order who still
   * has unresolved actions, or null if everyone is done.
   */
  private getActivePlayerId(state: GameState): string | null {
    for (const pid of state.turnOrder) {
      const player = state.players.find(p => p.playerId === pid);
      if (player && player.isConnected && this.hasUnresolvedActions(player.actionSlots)) {
        return pid;
      }
    }
    return null;
  }

  /**
   * Creates a pending decision for only the current active player
   * (first in turn order with unresolved actions).
   */
  private buildPendingForActivePlayer(state: GameState): GameState {
    const activeId = this.getActivePlayerId(state);
    if (!activeId) {
      return { ...state, pendingDecisions: [] };
    }

    // Determine the next action type for this player to set the correct timeout
    const player = state.players.find(p => p.playerId === activeId);
    let timeout = 30_000; // default fallback
    if (player) {
      const unresolvedSlots = player.actionSlots
        .filter((s): s is NonNullable<typeof s> => s !== null && !s.resolved)
        .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType]);
      if (unresolvedSlots.length > 0) {
        timeout = ACTION_TIMEOUTS[unresolvedSlots[0].actionType] ?? 30_000;
      }
    }

    const now = Date.now();
    return {
      ...state,
      pendingDecisions: [{
        playerId: activeId,
        decisionType: 'RESOLVE_ACTION' as const,
        timeoutAt: now + timeout,
        options: null as unknown,
      }],
    };
  }
}
