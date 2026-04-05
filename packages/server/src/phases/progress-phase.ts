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

import type { ClientMessage, GameState, PlayerState, Result, GameError, ProgressTrackType } from '@khora/shared';
import type { PhaseManager } from './omen-phase';
import { advanceTrack, addVP, subtractCoins, subtractPhilosophyTokens } from '../resources';
import { hasCardInPlay } from '../card-handlers';
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
  /** Stores pre-progress player snapshots so undo can restore them. */
  private snapshots = new Map<string, PlayerState>();

  onEnter(state: GameState): GameState {
    this.snapshots.clear();

    const now = Date.now();
    const pendingDecisions = state.turnOrder
      .filter(pid => {
        const p = state.players.find(pl => pl.playerId === pid);
        return p && p.isConnected;
      })
      .map(pid => ({
        playerId: pid,
        decisionType: 'PROGRESS_TRACK' as const,
        timeoutAt: now + 30_000,
        options: null as unknown,
      }));

    return { ...state, pendingDecisions };
  }

  handleDecision(
    state: GameState,
    playerId: string,
    decision: ClientMessage,
  ): Result<GameState, GameError> {
    if (decision.type === 'SKIP_PHASE') {
      let updatedState = state;
      // Old Guard: +4 VP if player has the card and skips progress
      const player = state.players.find(p => p.playerId === playerId);
      if (player && hasCardInPlay(player, 'old-guard')) {
        const playerIdx = state.players.findIndex(p => p.playerId === playerId);
        const updatedPlayers = [...updatedState.players];
        updatedPlayers[playerIdx] = addVP(updatedPlayers[playerIdx], 4);
        updatedState = { ...updatedState, players: updatedPlayers };
        updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'PROGRESS', playerId, action: 'Old Guard: +4 VP for skipping progress', details: { vp: 4 } });
      }
      const updatedDecisions = updatedState.pendingDecisions.filter(d => d.playerId !== playerId);
      this.snapshots.delete(playerId);
      return { ok: true, value: this.finishOrDisplay({ ...updatedState, pendingDecisions: updatedDecisions }) };
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

    let player = state.players[playerIndex];
    const { advancement, extraTracks, bonusTracks } = decision;

    // Save snapshot before any changes
    this.snapshots.set(playerId, player);

    // Primary advancement (free, just pay drachmas)
    if (advancement) {
      const result = this.advanceOneTrack(player, advancement.track);
      if (!result.ok) { this.snapshots.delete(playerId); return result; }
      player = result.value;
    }

    // Reformists bonus advancements (free, just pay drachmas — no philosophy token)
    if (bonusTracks && bonusTracks.length > 0) {
      const hasReformists = hasCardInPlay(player, 'reformists');
      const maxBonus = hasReformists ? 1 : 0;
      if (bonusTracks.length > maxBonus) {
        this.snapshots.delete(playerId);
        return { ok: false, error: { code: 'INVALID_DECISION', message: 'No card granting bonus track advancements' } };
      }
      for (const bonus of bonusTracks) {
        const result = this.advanceOneTrack(player, bonus.track);
        if (!result.ok) { this.snapshots.delete(playerId); return result; }
        player = result.value;
      }
    }

    // Extra advancements (each costs 1 philosophy token + drachmas)
    if (extraTracks && extraTracks.length > 0) {
      for (const extra of extraTracks) {
        const philResult = subtractPhilosophyTokens(player, 1);
        if (!philResult.ok) {
          this.snapshots.delete(playerId);
          return { ok: false, error: { code: 'INSUFFICIENT_RESOURCES', message: 'Need 1 philosophy token per extra advancement' } };
        }
        player = philResult.value;

        const result = this.advanceOneTrack(player, extra.track);
        if (!result.ok) { this.snapshots.delete(playerId); return result; }
        player = result.value;
      }
    }

    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = player;

    const updatedDecisions = state.pendingDecisions.filter(d => d.playerId !== playerId);

    let updatedState: GameState = { ...state, players: updatedPlayers, pendingDecisions: updatedDecisions };

    // Log track advancements with detailed changes
    const playerBefore = state.players[playerIndex];
    if (advancement) {
      updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'PROGRESS', playerId, action: `Advanced ${advancement.track}`, details: { track: advancement.track } });
    }
    if (bonusTracks && bonusTracks.length > 0) {
      for (const bonus of bonusTracks) {
        updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'PROGRESS', playerId, action: `Advanced ${bonus.track} (Reformists)`, details: { track: bonus.track } });
      }
    }
    if (extraTracks && extraTracks.length > 0) {
      for (const extra of extraTracks) {
        updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'PROGRESS', playerId, action: `Advanced ${extra.track} (philosophy token)`, details: { track: extra.track } });
      }
    }
    updatedState = logPlayerDiff(updatedState, playerBefore, player, { roundNumber: state.roundNumber, phase: 'PROGRESS', source: 'Progress' });

    return { ok: true, value: this.finishOrDisplay(updatedState) };
  }

  private handleUndo(
    state: GameState,
    playerId: string,
  ): Result<GameState, GameError> {
    const snapshot = this.snapshots.get(playerId);
    if (!snapshot) {
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

    // Restore the snapshot
    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = snapshot;
    this.snapshots.delete(playerId);

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

    return { ok: true, value: { ...state, players: updatedPlayers, pendingDecisions: updatedDecisions } };
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
      return {
        ...state,
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

  autoResolve(state: GameState, playerId: string): GameState {
    if (playerId === '__display__') {
      return { ...state, pendingDecisions: [] };
    }
    let updatedState = state;
    // Old Guard: +4 VP if player has the card (auto-resolve = skip = no progress)
    const player = state.players.find(p => p.playerId === playerId);
    if (player && hasCardInPlay(player, 'old-guard')) {
      const playerIdx = state.players.findIndex(p => p.playerId === playerId);
      const updatedPlayers = [...updatedState.players];
      updatedPlayers[playerIdx] = addVP(updatedPlayers[playerIdx], 4);
      updatedState = { ...updatedState, players: updatedPlayers };
      updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'PROGRESS', playerId, action: 'Old Guard: +4 VP for skipping progress', details: { vp: 4 } });
    } else {
      updatedState = appendLogEntry(updatedState, { roundNumber: state.roundNumber, phase: 'PROGRESS', playerId, action: 'Skipped progress (auto)', details: { auto: true } });
    }
    const updatedDecisions = updatedState.pendingDecisions.filter(d => d.playerId !== playerId);
    this.snapshots.delete(playerId);
    return this.finishOrDisplay({ ...updatedState, pendingDecisions: updatedDecisions });
  }
}
