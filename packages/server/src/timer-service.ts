/**
 * Timer service for Khora Online.
 *
 * Manages per-player decision timers using setTimeout.
 * Stores timer references in a Map keyed by "gameId:playerId".
 */

interface TimerEntry {
  timerId: ReturnType<typeof setTimeout>;
  startedAt: number;
  durationMs: number;
}

export class TimerService {
  private timers = new Map<string, TimerEntry>();

  private key(gameId: string, playerId: string): string {
    return `${gameId}:${playerId}`;
  }

  /**
   * Start a countdown timer for a player's decision.
   * If a timer already exists for this player, it is cancelled first.
   */
  startTimer(
    gameId: string,
    playerId: string,
    durationMs: number,
    onTimeout: () => void,
  ): void {
    const k = this.key(gameId, playerId);
    // Cancel existing timer if any
    this.cancelTimer(gameId, playerId);

    const timerId = setTimeout(() => {
      this.timers.delete(k);
      onTimeout();
    }, durationMs);

    this.timers.set(k, {
      timerId,
      startedAt: Date.now(),
      durationMs,
    });
  }

  /**
   * Cancel an active timer for a player.
   */
  cancelTimer(gameId: string, playerId: string): void {
    const k = this.key(gameId, playerId);
    const entry = this.timers.get(k);
    if (entry) {
      clearTimeout(entry.timerId);
      this.timers.delete(k);
    }
  }

  /**
   * Get the remaining time in milliseconds for a player's timer.
   * Returns 0 if no timer is active.
   */
  getRemainingTime(gameId: string, playerId: string): number {
    const k = this.key(gameId, playerId);
    const entry = this.timers.get(k);
    if (!entry) return 0;
    const elapsed = Date.now() - entry.startedAt;
    return Math.max(0, entry.durationMs - elapsed);
  }
}
