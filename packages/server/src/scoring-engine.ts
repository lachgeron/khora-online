/**
 * ScoringEngine — handles all Victory Point calculations including final scoring.
 *
 * Per the official Khora rules, final scoring is:
 * - End-game development points
 * - End-game politics card points
 * - Glory track level * number of Major Knowledge tokens
 *
 * Tiebreaker: most drachmas. If still tied, shared victory.
 */

import type {
  GameState,
  PlayerState,
} from '@khora/shared';
import type { FinalScoreBoard, PlayerFinalScore } from '@khora/shared';
import { calculateDevEndGameScore } from './city-dev-handlers';

/**
 * Calculates the final scores for all players, summing all VP sources.
 *
 * VP on the score track is accumulated during the game (Culture action, Glory phase, etc.).
 * Final scoring adds:
 * - End-game development effects
 * - End-game politics card effects
 * - Glory track level * number of Major Knowledge tokens
 */
export function calculateFinalScores(state: GameState): FinalScoreBoard {
  const scores: PlayerFinalScore[] = state.players.map((player) => {
    const detailedSources: { label: string; points: number }[] = [];
    const averageDiceRoll = calculateAverageDiceRoll(player);

    if (player.hasFlagged) {
      detailedSources.push({ label: 'Flagged on time', points: 0 });
      return {
        playerId: player.playerId,
        playerName: player.playerName,
        averageDiceRoll,
        breakdown: {
          scoreTrackPoints: 0,
          developmentPoints: 0,
          politicsCardPoints: 0,
          gloryKnowledgePoints: 0,
          detailedSources,
        },
        totalPoints: 0,
        rank: 0,
      };
    }

    // Score track VP (accumulated during the game)
    detailedSources.push({ label: 'In-game score track', points: player.victoryPoints });

    // End-game politics card scoring — itemized per card
    let politicsCardPoints = 0;
    for (const card of player.playedCards) {
      if (card.type === 'END_GAME' && card.endGameScoring !== null) {
        const pts = card.endGameScoring.calculate(player);
        politicsCardPoints += pts;
        if (pts > 0) {
          detailedSources.push({ label: `${card.name}: ${card.endGameScoring.description}`, points: pts });
        }
      }
    }

    // End-game development scoring from city tile
    const developmentPoints = calculateDevEndGameScore(player);
    if (developmentPoints > 0) {
      detailedSources.push({ label: 'City development (end-game)', points: developmentPoints });
    }

    // Glory track * Major Knowledge tokens
    const majorKnowledgeCount = player.knowledgeTokens.filter(
      (t) => t.tokenType === 'MAJOR',
    ).length;
    const gloryKnowledgePoints = player.gloryTrack * majorKnowledgeCount;
    if (gloryKnowledgePoints > 0) {
      detailedSources.push({ label: `Glory (${player.gloryTrack}) × Major tokens (${majorKnowledgeCount})`, points: gloryKnowledgePoints });
    }

    const totalPoints =
      player.victoryPoints +
      developmentPoints +
      politicsCardPoints +
      gloryKnowledgePoints;

    return {
      playerId: player.playerId,
      playerName: player.playerName,
      averageDiceRoll,
      breakdown: {
        scoreTrackPoints: player.victoryPoints,
        developmentPoints,
        politicsCardPoints,
        gloryKnowledgePoints,
        detailedSources,
      },
      totalPoints,
      rank: 0,
    };
  });

  const ranked = applyTiebreakers(scores, state.players);

  return {
    rankings: ranked,
    winnerId: ranked.length > 0 ? ranked[0].playerId : '',
  };
}

function calculateAverageDiceRoll(player: PlayerState): number | null {
  const rolls = player.diceRollHistory ?? [];
  if (rolls.length === 0) return null;
  const total = rolls.reduce((sum, die) => sum + die, 0);
  return Math.round((total / rolls.length) * 10) / 10;
}

/**
 * Sorts scores by total VP descending, then by most drachmas.
 * If still tied, it's a shared victory.
 * Assigns rank numbers (1-based).
 */
export function applyTiebreakers(
  scores: PlayerFinalScore[],
  players?: PlayerState[],
): PlayerFinalScore[] {
  const playerMap = new Map<string, PlayerState>();
  if (players) {
    for (const p of players) {
      playerMap.set(p.playerId, p);
    }
  }

  const sorted = [...scores].sort((a, b) => {
    // Primary: total VP descending
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;

    // Tiebreaker: most drachmas
    const aCoins = playerMap.get(a.playerId)?.coins ?? 0;
    const bCoins = playerMap.get(b.playerId)?.coins ?? 0;
    return bCoins - aCoins;
  });

  return sorted.map((score, index) => ({
    ...score,
    rank: index + 1,
  }));
}
