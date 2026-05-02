import { describe, it, expect } from 'vitest';
import { calculateFinalScores, applyTiebreakers } from './scoring-engine';
import { makeTestPlayer, makeTestGameState, makeTestKnowledgeToken } from './test-helpers';
import type { PlayerFinalScore } from '@khora/shared';

describe('ScoringEngine', () => {
  describe('calculateFinalScores', () => {
    it('scores flagged players as 0 regardless of VP sources', () => {
      const state = makeTestGameState({
        players: [
          makeTestPlayer({ playerId: 'p1', playerName: 'Alice', hasFlagged: true, victoryPoints: 99, coins: 99 }),
          makeTestPlayer({ playerId: 'p2', playerName: 'Bob', victoryPoints: 10 }),
        ],
      });

      const result = calculateFinalScores(state);
      const flagged = result.rankings.find(s => s.playerId === 'p1');

      expect(flagged?.totalPoints).toBe(0);
      expect(flagged?.breakdown.scoreTrackPoints).toBe(0);
    });

    it('sums VP + politicsCardPoints + gloryKnowledgePoints', () => {
      const player = makeTestPlayer({
        playerId: 'p1',
        victoryPoints: 20,
        gloryTrack: 3,
        knowledgeTokens: [
          makeTestKnowledgeToken({ id: 'kt-1', tokenType: 'MAJOR', color: 'GREEN' }),
          makeTestKnowledgeToken({ id: 'kt-2', tokenType: 'MAJOR', color: 'BLUE' }),
          makeTestKnowledgeToken({ id: 'kt-3', tokenType: 'MINOR', color: 'RED' }),
        ],
        playedCards: [
          {
            id: 'pc1',
            name: 'End Game Card',
            description: '',
            cost: 3,
            knowledgeRequirement: { green: 0, blue: 0, red: 0 },
            type: 'END_GAME',
            effect: { type: 'GAIN_VP', amount: 0 },
            endGameScoring: {
              type: 'CUSTOM',
              calculate: () => 4,
              description: '4 VP',
            },
          },
        ],
      });

      const state = makeTestGameState({ players: [player] });
      const result = calculateFinalScores(state);

      expect(result.rankings).toHaveLength(1);
      const score = result.rankings[0];
      // gloryKnowledgePoints = gloryTrack(3) * majorCount(2) = 6
      expect(score.breakdown.gloryKnowledgePoints).toBe(6);
      expect(score.breakdown.politicsCardPoints).toBe(4);
      // totalPoints = VP(20) + dev(0) + politics(4) + glory(6) = 30
      expect(score.totalPoints).toBe(30);
    });

    it('handles player with no end-game cards or knowledge tokens', () => {
      const player = makeTestPlayer({
        victoryPoints: 10,
        gloryTrack: 0,
        knowledgeTokens: [],
        playedCards: [],
      });
      const state = makeTestGameState({ players: [player] });

      const result = calculateFinalScores(state);

      expect(result.rankings[0].totalPoints).toBe(10);
      expect(result.rankings[0].breakdown.politicsCardPoints).toBe(0);
      expect(result.rankings[0].breakdown.gloryKnowledgePoints).toBe(0);
    });

    it('calculates average dice roll per individual die to one decimal place', () => {
      const player = makeTestPlayer({
        diceRollHistory: [1, 2, 3, 4, 5, 6, 4],
      });
      const state = makeTestGameState({ players: [player] });

      const result = calculateFinalScores(state);

      expect(result.rankings[0].averageDiceRoll).toBe(3.6);
    });

    it('ranks players by total VP descending', () => {
      const p1 = makeTestPlayer({ playerId: 'p1', playerName: 'Alice', victoryPoints: 10 });
      const p2 = makeTestPlayer({ playerId: 'p2', playerName: 'Bob', victoryPoints: 20 });
      const state = makeTestGameState({ players: [p1, p2] });

      const result = calculateFinalScores(state);

      expect(result.rankings[0].playerId).toBe('p2');
      expect(result.rankings[1].playerId).toBe('p1');
      expect(result.winnerId).toBe('p2');
    });

    it('applies tiebreaker: most drachmas (coins)', () => {
      const p1 = makeTestPlayer({ playerId: 'p1', victoryPoints: 15, coins: 10 });
      const p2 = makeTestPlayer({ playerId: 'p2', victoryPoints: 15, coins: 5 });
      const state = makeTestGameState({ players: [p1, p2] });

      const result = calculateFinalScores(state);

      // p1 has more coins, wins the tiebreaker
      expect(result.rankings[0].playerId).toBe('p1');
    });

    it('assigns correct rank numbers', () => {
      const p1 = makeTestPlayer({ playerId: 'p1', victoryPoints: 5 });
      const p2 = makeTestPlayer({ playerId: 'p2', victoryPoints: 15 });
      const p3 = makeTestPlayer({ playerId: 'p3', victoryPoints: 10 });
      const state = makeTestGameState({ players: [p1, p2, p3] });

      const result = calculateFinalScores(state);

      expect(result.rankings[0].rank).toBe(1);
      expect(result.rankings[1].rank).toBe(2);
      expect(result.rankings[2].rank).toBe(3);
    });

    it('only counts END_GAME politics cards for scoring', () => {
      const player = makeTestPlayer({
        victoryPoints: 0,
        playedCards: [
          {
            id: 'pc1',
            name: 'Immediate Card',
            description: '',
            cost: 2,
            knowledgeRequirement: { green: 0, blue: 0, red: 0 },
            type: 'IMMEDIATE',
            effect: { type: 'GAIN_VP', amount: 5 },
            endGameScoring: null,
          },
          {
            id: 'pc2',
            name: 'Ongoing Card',
            description: '',
            cost: 3,
            knowledgeRequirement: { green: 0, blue: 0, red: 0 },
            type: 'ONGOING',
            effect: { type: 'GAIN_VP', amount: 0 },
            endGameScoring: null,
          },
        ],
      });
      const state = makeTestGameState({ players: [player] });

      const result = calculateFinalScores(state);

      expect(result.rankings[0].breakdown.politicsCardPoints).toBe(0);
    });

    it('handles empty player list', () => {
      const state = makeTestGameState({ players: [] });
      const result = calculateFinalScores(state);

      expect(result.rankings).toHaveLength(0);
      expect(result.winnerId).toBe('');
    });
  });

  describe('applyTiebreakers', () => {
    it('sorts by total VP descending', () => {
      const scores: PlayerFinalScore[] = [
        { playerId: 'p1', playerName: 'A', averageDiceRoll: null, breakdown: { scoreTrackPoints: 10, developmentPoints: 0, politicsCardPoints: 0, gloryKnowledgePoints: 0, detailedSources: [] }, totalPoints: 10, rank: 0 },
        { playerId: 'p2', playerName: 'B', averageDiceRoll: null, breakdown: { scoreTrackPoints: 20, developmentPoints: 0, politicsCardPoints: 0, gloryKnowledgePoints: 0, detailedSources: [] }, totalPoints: 20, rank: 0 },
      ];

      const result = applyTiebreakers(scores);

      expect(result[0].playerId).toBe('p2');
      expect(result[1].playerId).toBe('p1');
    });

    it('breaks ties by most drachmas when players provided', () => {
      const scores: PlayerFinalScore[] = [
        { playerId: 'p1', playerName: 'A', averageDiceRoll: null, breakdown: { scoreTrackPoints: 15, developmentPoints: 0, politicsCardPoints: 0, gloryKnowledgePoints: 0, detailedSources: [] }, totalPoints: 15, rank: 0 },
        { playerId: 'p2', playerName: 'B', averageDiceRoll: null, breakdown: { scoreTrackPoints: 15, developmentPoints: 0, politicsCardPoints: 0, gloryKnowledgePoints: 0, detailedSources: [] }, totalPoints: 15, rank: 0 },
      ];
      const players = [
        makeTestPlayer({ playerId: 'p1', coins: 3 }),
        makeTestPlayer({ playerId: 'p2', coins: 8 }),
      ];

      const result = applyTiebreakers(scores, players);

      // p2 has more coins
      expect(result[0].playerId).toBe('p2');
    });

    it('assigns 1-based ranks', () => {
      const scores: PlayerFinalScore[] = [
        { playerId: 'p1', playerName: 'A', averageDiceRoll: null, breakdown: { scoreTrackPoints: 5, developmentPoints: 0, politicsCardPoints: 0, gloryKnowledgePoints: 0, detailedSources: [] }, totalPoints: 5, rank: 0 },
      ];

      const result = applyTiebreakers(scores);

      expect(result[0].rank).toBe(1);
    });
  });
});
