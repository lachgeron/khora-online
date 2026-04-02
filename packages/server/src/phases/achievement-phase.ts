/**
 * AchievementPhaseManager — handles the Achievement phase (Phase G).
 *
 * Rules:
 * - Each achievement can only be completed once.
 * - All qualifying players in the same round share the achievement.
 * - Each qualifying player chooses to advance either Tax or Glory track by 1
 *   PER achievement earned.
 * - Achievements are removed from available once claimed.
 */

import type { ClientMessage, GameState, Result, GameError, AchievementToken } from '@khora/shared';
import type { PhaseManager } from './omen-phase';
import { advanceTrack } from '../resources';
import { appendLogEntry } from '../game-log';

export class AchievementPhaseManager implements PhaseManager {
  onEnter(state: GameState): GameState {
    let updatedState = state;
    const remainingAchievements: AchievementToken[] = [];
    const pendingDecisions: GameState['pendingDecisions'] = [];
    const now = Date.now();

    for (const achievement of state.availableAchievements) {
      const qualifiers = state.players.filter(p =>
        p.isConnected && achievement.condition.evaluate(p),
      );

      if (qualifiers.length === 0) {
        remainingAchievements.push(achievement);
        continue;
      }

      // Claim the achievement for all qualifiers
      const claimedMap = new Map(updatedState.claimedAchievements);
      for (const p of qualifiers) {
        const existing = claimedMap.get(p.playerId) ?? [];
        claimedMap.set(p.playerId, [...existing, achievement]);
      }
      updatedState = { ...updatedState, claimedAchievements: claimedMap };

      // Create one pending decision per qualifier per achievement
      for (const p of qualifiers) {
        pendingDecisions.push({
          playerId: p.playerId,
          decisionType: 'ACHIEVEMENT_TRACK_CHOICE' as const,
          timeoutAt: now + 60_000,
          options: { achievementId: achievement.id, achievementName: achievement.name } as unknown,
        });

        updatedState = appendLogEntry(updatedState, {
          roundNumber: state.roundNumber,
          phase: 'ACHIEVEMENT',
          playerId: p.playerId,
          action: `Claimed achievement: ${achievement.name}`,
          details: { achievementId: achievement.id },
        });
      }
    }

    return {
      ...updatedState,
      availableAchievements: remainingAchievements,
      pendingDecisions,
    };
  }

  handleDecision(
    state: GameState,
    playerId: string,
    decision: ClientMessage,
  ): Result<GameState, GameError> {
    if (decision.type === 'SKIP_PHASE') {
      // Default all remaining achievements for this player to Tax
      let updatedState = state;
      const playerPending = state.pendingDecisions.filter(d => d.playerId === playerId);
      for (const _d of playerPending) {
        updatedState = this.applyTrackChoice(updatedState, playerId, 'TAX');
      }
      const updatedDecisions = updatedState.pendingDecisions.filter(d => d.playerId !== playerId);
      return { ok: true, value: { ...updatedState, pendingDecisions: updatedDecisions } };
    }

    if (decision.type !== 'CLAIM_ACHIEVEMENT') {
      return {
        ok: false,
        error: { code: 'INVALID_MESSAGE', message: 'Expected CLAIM_ACHIEVEMENT or SKIP_PHASE' },
      };
    }

    if (!state.pendingDecisions.some(d => d.playerId === playerId)) {
      return { ok: false, error: { code: 'NOT_YOUR_TURN', message: 'No pending achievement decision' } };
    }

    const trackChoice = decision.trackChoice;
    if (trackChoice !== 'TAX' && trackChoice !== 'GLORY') {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'Must choose TAX or GLORY' } };
    }

    const updatedState = this.applyTrackChoice(state, playerId, trackChoice);

    // Remove just the first matching pending decision for this player
    const idx = updatedState.pendingDecisions.findIndex(d =>
      d.playerId === playerId && d.decisionType === 'ACHIEVEMENT_TRACK_CHOICE',
    );
    const updatedDecisions = [...updatedState.pendingDecisions];
    if (idx !== -1) updatedDecisions.splice(idx, 1);

    return { ok: true, value: { ...updatedState, pendingDecisions: updatedDecisions } };
  }

  private applyTrackChoice(state: GameState, playerId: string, track: 'TAX' | 'GLORY'): GameState {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) return state;

    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = advanceTrack(updatedPlayers[playerIndex], track, 1);
    return { ...state, players: updatedPlayers };
  }

  isComplete(state: GameState): boolean {
    return state.pendingDecisions.length === 0;
  }

  autoResolve(state: GameState, playerId: string): GameState {
    // Default all remaining achievements for this player to Tax
    let updatedState = state;
    const playerPending = state.pendingDecisions.filter(d => d.playerId === playerId);
    for (const _d of playerPending) {
      updatedState = this.applyTrackChoice(updatedState, playerId, 'TAX');
    }
    const updatedDecisions = updatedState.pendingDecisions.filter(d => d.playerId !== playerId);
    return { ...updatedState, pendingDecisions: updatedDecisions };
  }
}
