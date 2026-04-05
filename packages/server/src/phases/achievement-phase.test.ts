import { describe, it, expect } from 'vitest';
import { AchievementPhaseManager } from './achievement-phase';
import { makeTestPlayer, makeTestGameState, makeTestAchievement } from '../test-helpers';

describe('AchievementPhaseManager', () => {
  const manager = new AchievementPhaseManager();

  describe('onEnter', () => {
    it('sole qualifier gets a pending decision, achievement removed from available, claim recorded', () => {
      const ach = makeTestAchievement('ach-1', {
        condition: {
          type: 'TRACK_LEVEL',
          evaluate: (p) => p.economyTrack >= 3,
          description: 'Economy >= 3',
        },
      });
      const player = makeTestPlayer({ playerId: 'p1', economyTrack: 4, taxTrack: 0 });
      const state = makeTestGameState({
        currentPhase: 'ACHIEVEMENT',
        players: [player],
        availableAchievements: [ach],
      });

      const result = manager.onEnter(state);

      // Achievement removed from available
      expect(result.availableAchievements).toHaveLength(0);
      // Claim recorded
      expect(result.claimedAchievements.get('p1')).toHaveLength(1);
      expect(result.claimedAchievements.get('p1')![0].id).toBe('ach-1');
      // Pending decision created
      expect(result.pendingDecisions).toHaveLength(1);
      expect(result.pendingDecisions[0].playerId).toBe('p1');
      expect(result.pendingDecisions[0].decisionType).toBe('ACHIEVEMENT_TRACK_CHOICE');
      expect(result.pendingDecisions[0].options).toEqual({ achievementId: 'ach-1', achievementName: 'Achievement ach-1' });
      // Tax track NOT auto-advanced
      expect(result.players[0].taxTrack).toBe(0);
    });

    it('multiple qualifiers both get pending decisions for a shared achievement', () => {
      const ach = makeTestAchievement('ach-1', {
        condition: {
          type: 'TRACK_LEVEL',
          evaluate: (p) => p.coins >= 5,
          description: 'At least 5 coins',
        },
      });
      const p1 = makeTestPlayer({ playerId: 'p1', coins: 10, taxTrack: 0 });
      const p2 = makeTestPlayer({ playerId: 'p2', coins: 8, taxTrack: 0 });
      const state = makeTestGameState({
        currentPhase: 'ACHIEVEMENT',
        players: [p1, p2],
        availableAchievements: [ach],
      });

      const result = manager.onEnter(state);

      // Achievement removed
      expect(result.availableAchievements).toHaveLength(0);
      // Both players have claims
      expect(result.claimedAchievements.get('p1')).toHaveLength(1);
      expect(result.claimedAchievements.get('p2')).toHaveLength(1);
      // Both get pending decisions
      expect(result.pendingDecisions).toHaveLength(2);
      const ids = result.pendingDecisions.map(d => d.playerId).sort();
      expect(ids).toEqual(['p1', 'p2']);
      // Tracks not auto-advanced
      expect(result.players[0].taxTrack).toBe(0);
      expect(result.players[1].taxTrack).toBe(0);
    });

    it('no qualifiers — achievement stays available, no pending decisions', () => {
      const ach = makeTestAchievement('ach-1', {
        condition: {
          type: 'TRACK_LEVEL',
          evaluate: (p) => p.economyTrack >= 99,
          description: 'Economy >= 99',
        },
      });
      const player = makeTestPlayer({ playerId: 'p1', economyTrack: 3 });
      const state = makeTestGameState({
        currentPhase: 'ACHIEVEMENT',
        players: [player],
        availableAchievements: [ach],
      });

      const result = manager.onEnter(state);

      expect(result.availableAchievements).toHaveLength(1);
      expect(result.availableAchievements[0].id).toBe('ach-1');
      expect(result.claimedAchievements.get('p1')).toBeUndefined();
      expect(result.pendingDecisions).toHaveLength(0);
    });

    it('player qualifies for multiple achievements — separate decision per achievement', () => {
      const ach1 = makeTestAchievement('ach-1', {
        condition: {
          type: 'TRACK_LEVEL',
          evaluate: (p) => p.economyTrack >= 3,
          description: 'Economy >= 3',
        },
      });
      const ach2 = makeTestAchievement('ach-2', {
        condition: {
          type: 'TRACK_LEVEL',
          evaluate: (p) => p.militaryTrack >= 4,
          description: 'Military >= 4',
        },
      });
      const player = makeTestPlayer({
        playerId: 'p1',
        economyTrack: 5,
        militaryTrack: 6,
        taxTrack: 0,
      });
      const state = makeTestGameState({
        currentPhase: 'ACHIEVEMENT',
        players: [player],
        availableAchievements: [ach1, ach2],
      });

      const result = manager.onEnter(state);

      // Both achievements removed
      expect(result.availableAchievements).toHaveLength(0);
      // Both claimed
      expect(result.claimedAchievements.get('p1')).toHaveLength(2);
      // Separate pending decision per achievement
      expect(result.pendingDecisions).toHaveLength(2);
      expect(result.pendingDecisions[0].playerId).toBe('p1');
      expect(result.pendingDecisions[1].playerId).toBe('p1');
      expect(result.pendingDecisions[0].options).toEqual({ achievementId: 'ach-1', achievementName: 'Achievement ach-1' });
      expect(result.pendingDecisions[1].options).toEqual({ achievementId: 'ach-2', achievementName: 'Achievement ach-2' });
      // Tax track NOT auto-advanced
      expect(result.players[0].taxTrack).toBe(0);
    });
  });

  describe('handleDecision', () => {
    function stateWithPendingDecision(
      playerId: string,
      achievementIds: string[],
      playerOverrides: Record<string, unknown> = {},
    ) {
      const player = makeTestPlayer({ playerId, taxTrack: 0, gloryTrack: 0, ...playerOverrides });
      return makeTestGameState({
        currentPhase: 'ACHIEVEMENT',
        players: [player],
        pendingDecisions: achievementIds.map(id => ({
          playerId,
          decisionType: 'ACHIEVEMENT_TRACK_CHOICE' as const,
          timeoutAt: Date.now() + 60_000,
          options: { achievementId: id, achievementName: `Achievement ${id}` },
        })),
      });
    }

    it('CLAIM_ACHIEVEMENT with TAX advances tax track by 1 per claim', () => {
      const state = stateWithPendingDecision('p1', ['ach-1', 'ach-2']);

      const result = manager.handleDecision(state, 'p1', {
        type: 'CLAIM_ACHIEVEMENT',
        achievementId: 'ach-1',
        trackChoice: 'TAX',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Only 1 achievement resolved, 1 still pending
        expect(result.value.players[0].taxTrack).toBe(1);
        expect(result.value.players[0].gloryTrack).toBe(0);
        expect(result.value.pendingDecisions).toHaveLength(1);
      }
    });

    it('CLAIM_ACHIEVEMENT with GLORY advances glory track by 1', () => {
      const state = stateWithPendingDecision('p1', ['ach-1']);

      const result = manager.handleDecision(state, 'p1', {
        type: 'CLAIM_ACHIEVEMENT',
        achievementId: 'ach-1',
        trackChoice: 'GLORY',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].gloryTrack).toBe(1);
        expect(result.value.players[0].taxTrack).toBe(0);
        // After last decision, a PHASE_DISPLAY is inserted
        expect(result.value.pendingDecisions).toHaveLength(1);
        expect(result.value.pendingDecisions[0].decisionType).toBe('PHASE_DISPLAY');
      }
    });

    it('SKIP_PHASE defaults to tax track advancement and removes pending decision', () => {
      const state = stateWithPendingDecision('p1', ['ach-1']);

      const result = manager.handleDecision(state, 'p1', { type: 'SKIP_PHASE' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.players[0].taxTrack).toBe(1);
        // After last decision, a PHASE_DISPLAY is inserted
        expect(result.value.pendingDecisions).toHaveLength(1);
        expect(result.value.pendingDecisions[0].decisionType).toBe('PHASE_DISPLAY');
      }
    });

    it('rejects with NOT_YOUR_TURN if player has no pending decision', () => {
      const player = makeTestPlayer({ playerId: 'p1' });
      const state = makeTestGameState({
        currentPhase: 'ACHIEVEMENT',
        players: [player],
        pendingDecisions: [],
      });

      const result = manager.handleDecision(state, 'p1', {
        type: 'CLAIM_ACHIEVEMENT',
        achievementId: 'ach-1',
        trackChoice: 'TAX',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NOT_YOUR_TURN');
      }
    });
  });

  describe('isComplete', () => {
    it('returns true when there are no pending decisions', () => {
      const state = makeTestGameState({ pendingDecisions: [] });
      expect(manager.isComplete(state)).toBe(true);
    });

    it('returns false when pending decisions remain', () => {
      const state = makeTestGameState({
        pendingDecisions: [{
          playerId: 'p1',
          decisionType: 'ACHIEVEMENT_TRACK_CHOICE' as const,
          timeoutAt: Date.now() + 60_000,
          options: ['ach-1'],
        }],
      });
      expect(manager.isComplete(state)).toBe(false);
    });
  });

  describe('autoResolve', () => {
    it('defaults to tax track advancement and removes the pending decision', () => {
      const player = makeTestPlayer({ playerId: 'p1', taxTrack: 0 });
      const state = makeTestGameState({
        currentPhase: 'ACHIEVEMENT',
        players: [player],
        pendingDecisions: [
          {
            playerId: 'p1',
            decisionType: 'ACHIEVEMENT_TRACK_CHOICE' as const,
            timeoutAt: Date.now() + 60_000,
            options: { achievementId: 'ach-1', achievementName: 'Achievement ach-1' },
          },
          {
            playerId: 'p1',
            decisionType: 'ACHIEVEMENT_TRACK_CHOICE' as const,
            timeoutAt: Date.now() + 60_000,
            options: { achievementId: 'ach-2', achievementName: 'Achievement ach-2' },
          },
        ],
      });

      const result = manager.autoResolve(state, 'p1');

      expect(result.players[0].taxTrack).toBe(2);
      // After last player resolves, a PHASE_DISPLAY is inserted
      expect(result.pendingDecisions).toHaveLength(1);
      expect(result.pendingDecisions[0].decisionType).toBe('PHASE_DISPLAY');

      // autoResolve for __display__ clears it
      const final = manager.autoResolve(result, '__display__');
      expect(final.pendingDecisions).toHaveLength(0);
    });
  });
});
