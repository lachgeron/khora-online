/**
 * Knowledge token management for Khora Online.
 *
 * Handles the central board tokens available for exploration
 * and requirement checking for politics cards and developments.
 */

import type { KnowledgeToken, KnowledgeRequirement, PlayerState, GameState } from '@khora/shared';
import type { KnowledgeColor } from '@khora/shared';
import type { Result, GameError } from '@khora/shared';

/**
 * Creates a Minor Knowledge token (purchased via Trade action).
 */
export function createMinorToken(color: KnowledgeColor): KnowledgeToken {
  return {
    id: `minor-${color.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    color,
    tokenType: 'MINOR',
  };
}

/**
 * Checks if a player can explore a specific knowledge token from the central board.
 * Requires: troop track >= token's troop requirement.
 */
export function canExplore(
  player: PlayerState,
  token: KnowledgeToken,
): boolean {
  if (token.militaryRequirement === undefined) return false;
  return player.troopTrack >= token.militaryRequirement;
}

/**
 * Performs exploration: player gains the token and loses troops
 * equal to the skull value.
 */
export function explore(
  state: GameState,
  playerId: string,
  tokenId: string,
): Result<GameState, GameError> {
  const tokenIndex = state.centralBoardTokens.findIndex(t => t.id === tokenId && !t.explored);
  if (tokenIndex === -1) {
    return {
      ok: false,
      error: { code: 'INVALID_DECISION', message: 'Token not found on central board' },
    };
  }

  const token = state.centralBoardTokens[tokenIndex];
  const playerIndex = state.players.findIndex(p => p.playerId === playerId);
  if (playerIndex === -1) {
    return {
      ok: false,
      error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' },
    };
  }

  const player = state.players[playerIndex];

  if (!canExplore(player, token)) {
    return {
      ok: false,
      error: {
        code: 'INSUFFICIENT_RESOURCES',
        message: `Troops ${player.troopTrack} insufficient for requirement ${token.militaryRequirement}`,
      },
    };
  }

  const skullLoss = token.skullValue ?? 0;
  // Helepole: spend 1 less troop when exploring
  const hasHelepole = player.playedCards.some(c => c.id === 'helepole');
  // Sparta dev 1: lose 1 less troop when exploring
  const hasSpartaDev = player.cityId === 'sparta' && player.developmentLevel >= 1;
  const troopReduction = (hasHelepole ? 1 : 0) + (hasSpartaDev ? 1 : 0);
  const actualSkullLoss = Math.max(0, skullLoss - troopReduction);
  const bonusCoins = token.bonusCoins ?? 0;
  const bonusVP = token.bonusVP ?? 0;

  // Persepolis: grants 1 major of each color instead of the token itself
  let gainedTokens: KnowledgeToken[];
  if (token.isPersepolis) {
    gainedTokens = [
      { id: `persepolis-red-${Date.now()}`, color: 'RED', tokenType: 'MAJOR' },
      { id: `persepolis-blue-${Date.now()}`, color: 'BLUE', tokenType: 'MAJOR' },
      { id: `persepolis-green-${Date.now()}`, color: 'GREEN', tokenType: 'MAJOR' },
    ];
  } else {
    gainedTokens = [token];
  }

  const updatedPlayer = {
    ...player,
    troopTrack: Math.max(0, player.troopTrack - actualSkullLoss),
    coins: player.coins + bonusCoins,
    victoryPoints: player.victoryPoints + bonusVP,
    knowledgeTokens: [...player.knowledgeTokens, ...gainedTokens],
  };

  const updatedTokens = state.centralBoardTokens.map((t, i) =>
    i === tokenIndex ? { ...t, explored: true } : t,
  );

  const updatedPlayers = [...state.players];
  updatedPlayers[playerIndex] = updatedPlayer;

  return {
    ok: true,
    value: {
      ...state,
      players: updatedPlayers,
      centralBoardTokens: updatedTokens,
    },
  };
}

/**
 * Checks if a knowledge requirement is empty (no tokens needed).
 */
export function isEmptyRequirement(req: KnowledgeRequirement): boolean {
  return req.green === 0 && req.blue === 0 && req.red === 0;
}
