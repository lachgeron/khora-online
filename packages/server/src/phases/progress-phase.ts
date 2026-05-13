/**
 * ProgressPhaseManager — handles the Progress phase (Phase E) of each round.
 *
 * Per the official rules:
 * - In turn order, each player may advance ONE progress track
 *   (Economy, Culture, or Military) by paying the drachma cost for the next level.
 * - Each philosophy token spent allows one additional track advancement
 *   (still paying drachmas for each).
 * - Players lock in their choices and can undo before the phase completes.
 */

import type { ClientMessage, GameState, PlayerState, Result, GameError, ProgressSubmission, ProgressTrackType } from '@khora/shared';
import type { PhaseManager } from './omen-phase';
import { advanceTrack, addVP, subtractCoins, subtractPhilosophyTokens } from '../resources';
import { hasCardInPlay } from '../card-handlers';
import { hasDevUnlocked } from '../city-dev-handlers';
import { appendLogEntry, logPlayerDiff } from '../game-log';

/** Drachma costs per track, indexed by current level (cost to advance FROM that level). */
const ECONOMY_COSTS: Record<number, number> = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 };
const CULTURE_COSTS: Record<number, number> = { 1: 1, 2: 4, 3: 6, 4: 6, 5: 7, 6: 7 };
const MILITARY_COSTS: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9 };

const PROGRESS_COST_MAP: Record<string, Record<number, number>> = {
  ECONOMY: ECONOMY_COSTS,
  CULTURE: CULTURE_COSTS,
  MILITARY: MILITARY_COSTS,
};

const MAX_PROGRESS_LEVEL = 7;

export class ProgressPhaseManager implements PhaseManager {
  onEnter(state: GameState): GameState {
    const now = Date.now();
    const pendingDecisions = state.turnOrder
      .filter(pid => {
        const p = state.players.find(pl => pl.playerId === pid);
        return p && p.isConnected && !p.hasFlagged;
      })
      .map(pid => ({
        playerId: pid,
        decisionType: 'PROGRESS_TRACK' as const,
        timeoutAt: now + 30_000,
        options: null as unknown,
      }));

    return { ...state, pendingDecisions, progressSubmissions: {} };
  }

  handleDecision(
    state: GameState,
    playerId: string,
    decision: ClientMessage,
  ): Result<GameState, GameError> {
    if (decision.type === 'SKIP_PHASE') {
      if (!this.hasPendingProgressDecision(state, playerId)) {
        return { ok: false, error: { code: 'NOT_YOUR_TURN', message: 'No pending progress decision' } };
      }
      return { ok: true, value: this.commitProgressSubmission(state, playerId, { skipped: true }) };
    }

    if (decision.type === 'UNDO_PROGRESS') {
      return this.handleUndo(state, playerId);
    }

    if (decision.type !== 'PROGRESS_TRACK') {
      return {
        ok: false,
        error: { code: 'INVALID_MESSAGE', message: 'Expected PROGRESS_TRACK, UNDO_PROGRESS, or SKIP_PHASE' },
      };
    }

    // Guard: player must have a pending decision
    if (!state.pendingDecisions.some(d => d.playerId === playerId)) {
      return { ok: false, error: { code: 'NOT_YOUR_TURN', message: 'No pending progress decision' } };
    }

    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };
    }

    const player = state.players[playerIndex];
    const { advancement, extraTracks, bonusTracks } = decision;

    if (!advancement) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'No progress track selected' } };
    }

    const submission: ProgressSubmission = { advancement, extraTracks, bonusTracks };
    const validation = this.applySubmissionToPlayer(player, submission);
    if (!validation.ok) return validation;

    return { ok: true, value: this.commitProgressSubmission(state, playerId, submission) };
  }

  private handleUndo(
    state: GameState,
    playerId: string,
  ): Result<GameState, GameError> {
    const submissions = state.progressSubmissions ?? {};
    if (!submissions[playerId]) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'No progress to undo' } };
    }

    // Player must NOT have a pending decision (they already committed)
    if (state.pendingDecisions.some(d => d.playerId === playerId)) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'Progress not yet committed' } };
    }

    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };
    }

    // Re-add pending decision
    const now = Date.now();
    const updatedDecisions = [
      ...state.pendingDecisions,
      {
        playerId,
        decisionType: 'PROGRESS_TRACK' as const,
        timeoutAt: now + 30_000,
        options: null as unknown,
      },
    ];

    const remainingSubmissions = { ...submissions };
    delete remainingSubmissions[playerId];

    return {
      ok: true,
      value: {
        ...state,
        pendingDecisions: updatedDecisions,
        progressSubmissions: remainingSubmissions,
      },
    };
  }

  private hasPendingProgressDecision(state: GameState, playerId: string): boolean {
    return state.pendingDecisions.some(
      d => d.playerId === playerId && d.decisionType === 'PROGRESS_TRACK',
    );
  }

  private commitProgressSubmission(
    state: GameState,
    playerId: string,
    submission: ProgressSubmission,
  ): GameState {
    const updatedDecisions = state.pendingDecisions.filter(d => d.playerId !== playerId);
    const progressSubmissions = {
      ...(state.progressSubmissions ?? {}),
      [playerId]: this.cloneSubmission(submission),
    };

    return this.finishOrDisplay({
      ...state,
      pendingDecisions: updatedDecisions,
      progressSubmissions,
    });
  }

  private cloneSubmission(submission: ProgressSubmission): ProgressSubmission {
    return {
      ...submission,
      advancement: submission.advancement ? { ...submission.advancement } : undefined,
      extraTracks: submission.extraTracks?.map(track => ({ ...track })),
      bonusTracks: submission.bonusTracks?.map(track => ({ ...track })),
    };
  }

  private applySubmissionToPlayer(
    player: PlayerState,
    submission: ProgressSubmission,
  ): Result<PlayerState, GameError> {
    let updatedPlayer = player;

    if (submission.skipped) {
      return { ok: true, value: updatedPlayer };
    }

    if (!submission.advancement) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'No progress track selected' } };
    }

    // Primary advancement (pay drachmas)
    const primaryResult = this.advanceOneTrack(updatedPlayer, submission.advancement.track);
    if (!primaryResult.ok) return primaryResult;
    updatedPlayer = primaryResult.value;

    // Reformists / Corinth dev 3 bonus advancements (pay drachmas — no philosophy token)
    if (submission.bonusTracks && submission.bonusTracks.length > 0) {
      const hasReformists = hasCardInPlay(updatedPlayer, 'reformists');
      const hasCorinthDev3 = hasDevUnlocked(updatedPlayer, 'corinth-dev-3');
      const maxBonus = (hasReformists ? 1 : 0) + (hasCorinthDev3 ? 1 : 0);
      if (submission.bonusTracks.length > maxBonus) {
        return { ok: false, error: { code: 'INVALID_DECISION', message: 'No card granting bonus track advancements' } };
      }
      for (const bonus of submission.bonusTracks) {
        const result = this.advanceOneTrack(updatedPlayer, bonus.track);
        if (!result.ok) return result;
        updatedPlayer = result.value;
      }
    }

    // Extra advancements (each costs 1 philosophy token + drachmas)
    if (submission.extraTracks && submission.extraTracks.length > 0) {
      for (const extra of submission.extraTracks) {
        const philResult = subtractPhilosophyTokens(updatedPlayer, 1);
        if (!philResult.ok) {
          return { ok: false, error: { code: 'INSUFFICIENT_RESOURCES', message: 'Need 1 philosophy token per extra advancement' } };
        }
        updatedPlayer = philResult.value;

        const result = this.advanceOneTrack(updatedPlayer, extra.track);
        if (!result.ok) return result;
        updatedPlayer = result.value;
      }
    }

    return { ok: true, value: updatedPlayer };
  }

  private advanceOneTrack(
    player: PlayerState,
    track: ProgressTrackType,
  ): Result<PlayerState, GameError> {
    const currentLevel = (() => {
      switch (track) {
        case 'ECONOMY': return player.economyTrack;
        case 'CULTURE': return player.cultureTrack;
        case 'MILITARY': return player.militaryTrack;
      }
    })();

    if (currentLevel >= MAX_PROGRESS_LEVEL) {
      return { ok: false, error: { code: 'TRACK_MAX_REACHED', message: `${track} track is already at maximum level ${MAX_PROGRESS_LEVEL}` } };
    }

    const trackCosts = PROGRESS_COST_MAP[track] ?? {};
    let cost = trackCosts[currentLevel] ?? 99;

    // Constructing the Mint: Economy progress is free
    if (track === 'ECONOMY' && hasCardInPlay(player, 'constructing-the-mint')) {
      cost = 0;
    }

    // Gradualism: pay 1 less Drachma on any progress advancement
    if (cost > 0 && hasCardInPlay(player, 'gradualism')) {
      cost = Math.max(0, cost - 1);
    }

    // Corinth dev 3: pay 1 less Drachma on any progress advancement
    if (cost > 0 && hasDevUnlocked(player, 'corinth-dev-3')) {
      cost = Math.max(0, cost - 1);
    }

    if (cost > 0) {
      const costResult = subtractCoins(player, cost);
      if (!costResult.ok) return { ok: false, error: costResult.error };
      let updated = costResult.value;
      updated = advanceTrack(updated, track, 1);
      return { ok: true, value: updated };
    }

    const updated = advanceTrack(player, track, 1);
    return { ok: true, value: updated };
  }

  isComplete(state: GameState): boolean {
    return state.pendingDecisions.length === 0;
  }

  /** Insert a display pause when all player decisions are resolved. */
  private finishOrDisplay(state: GameState): GameState {
    const remaining = state.pendingDecisions.filter(d => d.decisionType !== 'PHASE_DISPLAY');
    if (remaining.length === 0 && !state.pendingDecisions.some(d => d.decisionType === 'PHASE_DISPLAY')) {
      const revealedState = this.applySubmittedProgress(state);
      return {
        ...revealedState,
        pendingDecisions: [{
          playerId: '__display__',
          decisionType: 'PHASE_DISPLAY' as const,
          timeoutAt: Date.now() + 15_000,
          options: null as unknown,
        }],
      };
    }
    return state;
  }

  /**
   * Used when another system removes a progress pending decision, such as a
   * player flagging on time. If that was the last unresolved choice, reveal the
   * already locked choices and enter the display pause.
   */
  finishAfterExternalPendingChange(state: GameState): GameState {
    return this.finishOrDisplay(state);
  }

  private applySubmittedProgress(state: GameState): GameState {
    const submissions = state.progressSubmissions ?? {};
    let updatedState: GameState = { ...state, progressSubmissions: {} };

    const orderedPlayerIds = [
      ...state.turnOrder,
      ...Object.keys(submissions).filter(playerId => !state.turnOrder.includes(playerId)),
    ];

    for (const playerId of orderedPlayerIds) {
      const submission = submissions[playerId];
      if (!submission) continue;

      const playerIndex = updatedState.players.findIndex(p => p.playerId === playerId);
      if (playerIndex === -1) continue;

      const playerBefore = updatedState.players[playerIndex];
      if (playerBefore.hasFlagged) continue;

      if (submission.skipped) {
        if (hasCardInPlay(playerBefore, 'old-guard')) {
          const updatedPlayers = [...updatedState.players];
          updatedPlayers[playerIndex] = addVP(updatedPlayers[playerIndex], 4);
          updatedState = { ...updatedState, players: updatedPlayers };
          updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'PROGRESS', playerId, action: 'Old Guard: +4 VP for skipping progress', details: { vp: 4 } });
        } else if (submission.auto) {
          updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'PROGRESS', playerId, action: 'Skipped progress (auto)', details: { auto: true } });
        }
        continue;
      }

      const result = this.applySubmissionToPlayer(playerBefore, submission);
      if (!result.ok) continue;

      const updatedPlayers = [...updatedState.players];
      updatedPlayers[playerIndex] = result.value;
      updatedState = { ...updatedState, players: updatedPlayers };

      if (submission.advancement) {
        updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'PROGRESS', playerId, action: `Advanced ${submission.advancement.track}`, details: { track: submission.advancement.track } });
      }
      if (submission.bonusTracks && submission.bonusTracks.length > 0) {
        for (const bonus of submission.bonusTracks) {
          updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'PROGRESS', playerId, action: `Advanced ${bonus.track} (Reformists)`, details: { track: bonus.track } });
        }
      }
      if (submission.extraTracks && submission.extraTracks.length > 0) {
        for (const extra of submission.extraTracks) {
          updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'PROGRESS', playerId, action: `Advanced ${extra.track} (philosophy token)`, details: { track: extra.track } });
        }
      }
      updatedState = logPlayerDiff(updatedState, playerBefore, result.value, { roundNumber: state.roundNumber, phase: 'PROGRESS', source: 'Progress' });
    }

    return updatedState;
  }

  autoResolve(state: GameState, playerId: string): GameState {
    if (playerId === '__display__') {
      return { ...state, pendingDecisions: [] };
    }
    if (!this.hasPendingProgressDecision(state, playerId)) {
      return state;
    }
    return this.commitProgressSubmission(state, playerId, { skipped: true, auto: true });
  }
}
