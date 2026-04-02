/**
 * Development action resolver (Action 6).
 *
 * Per the official rules:
 * - Unlock the next development on your city tile (max 3 per game)
 * - Verify knowledge token requirements (NOT spent)
 * - Pay the drachma cost shown on the development
 * - Apply the development's effect
 */

import type { ActionChoices, ActionCostResult, GameError, GameState, Result, CityCard } from '@khora/shared';
import { ACTION_NUMBERS, MAX_DEVELOPMENTS } from '@khora/shared';
import type { ActionResolver } from './action-resolver';
import { subtractCoins, meetsKnowledgeRequirement, subtractPhilosophyTokens } from '../resources';
import { getNextDevelopment, applyDevelopmentEffect } from '../city-abilities';
import { getAllCityCards } from '../game-data';
import { DEV_IMMEDIATE_HANDLERS } from '../city-dev-handlers';

export class DevelopmentResolver implements ActionResolver {
  readonly actionNumber = ACTION_NUMBERS.DEVELOPMENT; // 6
  readonly actionType = 'DEVELOPMENT' as const;

  /** City cards lookup — loaded from game data. */
  private cityCards: Map<string, CityCard>;

  constructor() {
    this.cityCards = new Map(getAllCityCards().map(c => [c.id, c]));
  }

  setCityCards(cards: CityCard[]): void {
    this.cityCards = new Map(cards.map(c => [c.id, c]));
  }

  canPerform(state: GameState, playerId: string, dieValue: number): ActionCostResult {
    const citizenCost = Math.max(0, this.actionNumber - dieValue);
    const player = state.players.find(p => p.playerId === playerId);
    if (!player) return { canPerform: false, citizenCost, reason: 'Player not found' };

    if (player.developmentLevel >= MAX_DEVELOPMENTS) {
      return { canPerform: false, citizenCost, reason: 'Maximum developments reached (3)' };
    }

    const city = this.cityCards.get(player.cityId);
    if (!city) return { canPerform: false, citizenCost, reason: 'City not found' };

    const nextDev = getNextDevelopment(city, player);
    if (!nextDev) return { canPerform: false, citizenCost, reason: 'No more developments' };

    // Check knowledge requirement — allow scrolls (2 per missing token) to cover shortfall
    if (!meetsKnowledgeRequirement(player, nextDev.knowledgeRequirement)) {
      const greenCount = player.knowledgeTokens.filter(t => t.color === 'GREEN').length;
      const blueCount = player.knowledgeTokens.filter(t => t.color === 'BLUE').length;
      const redCount = player.knowledgeTokens.filter(t => t.color === 'RED').length;
      const shortfall = Math.max(0, nextDev.knowledgeRequirement.green - greenCount)
        + Math.max(0, nextDev.knowledgeRequirement.blue - blueCount)
        + Math.max(0, nextDev.knowledgeRequirement.red - redCount);
      const scrollsNeeded = shortfall * 2;
      if (player.philosophyTokens < scrollsNeeded) {
        return { canPerform: false, citizenCost, reason: 'Knowledge requirements not met' };
      }
    }

    if (player.coins < nextDev.drachmaCost) {
      return { canPerform: false, citizenCost, reason: 'Insufficient drachmas' };
    }

    return { canPerform: true, citizenCost };
  }

  resolve(state: GameState, playerId: string, choices: ActionChoices): Result<GameState, GameError> {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };
    }

    let player = state.players[playerIndex];

    if (player.developmentLevel >= MAX_DEVELOPMENTS) {
      return {
        ok: false,
        error: { code: 'MAX_DEVELOPMENTS_REACHED', message: `Already unlocked maximum ${MAX_DEVELOPMENTS} developments` },
      };
    }

    const city = this.cityCards.get(player.cityId);
    if (!city) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'City not found' } };
    }

    const nextDev = getNextDevelopment(city, player);
    if (!nextDev) {
      return { ok: false, error: { code: 'MAX_DEVELOPMENTS_REACHED', message: 'No more developments' } };
    }

    const pairsToUse = choices.philosophyPairsToUse ?? 0;
    if (!meetsKnowledgeRequirement(player, nextDev.knowledgeRequirement, pairsToUse)) {
      return {
        ok: false,
        error: { code: 'INSUFFICIENT_KNOWLEDGE', message: 'Knowledge requirements not met' },
      };
    }

    // Deduct philosophy tokens used to cover knowledge shortfall
    if (pairsToUse > 0) {
      const philResult = subtractPhilosophyTokens(player, pairsToUse * 2);
      if (!philResult.ok) return { ok: false, error: philResult.error };
      player = philResult.value;
    }

    const costResult = subtractCoins(player, nextDev.drachmaCost);
    if (!costResult.ok) return { ok: false, error: costResult.error };
    player = costResult.value;

    player = { ...player, developmentLevel: player.developmentLevel + 1 };
    player = applyDevelopmentEffect(player, nextDev);

    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = player;

    let updatedState = { ...state, players: updatedPlayers };

    // Apply custom immediate handler if one exists
    const customHandler = DEV_IMMEDIATE_HANDLERS[nextDev.id];
    if (customHandler) {
      updatedState = customHandler(updatedState, playerId, choices);
    }

    return { ok: true, value: updatedState };
  }
}
