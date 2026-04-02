import type { GamePhase } from '@khora/shared';

/**
 * Legal transitions map: for each phase, the set of phases it can transition to.
 */
const LEGAL_TRANSITIONS: Record<GamePhase, GamePhase[]> = {
  LOBBY: ['CITY_SELECTION'],
  CITY_SELECTION: ['DRAFT_POLITICS'],
  DRAFT_POLITICS: ['OMEN'],
  OMEN: ['TAXATION'],
  TAXATION: ['DICE'],
  DICE: ['ACTIONS'],
  ACTIONS: ['PROGRESS'],
  PROGRESS: ['GLORY'],
  GLORY: ['ACHIEVEMENT'],
  ACHIEVEMENT: ['OMEN', 'FINAL_SCORING'],
  FINAL_SCORING: ['GAME_OVER'],
  GAME_OVER: [],
};

/**
 * Finite state machine that enforces legal game-phase transitions
 * and tracks the current round number (1–9).
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
export class StateMachine {
  currentPhase: GamePhase;
  roundNumber: number;

  constructor(initialPhase: GamePhase = 'LOBBY', initialRound: number = 1) {
    this.currentPhase = initialPhase;
    this.roundNumber = initialRound;
  }

  /**
   * Returns true if transitioning from `from` to `to` is legal
   * given the current round number.
   */
  canTransition(from: GamePhase, to: GamePhase): boolean {
    const allowed = LEGAL_TRANSITIONS[from];
    if (!allowed.includes(to)) return false;

    // ACHIEVEMENT → OMEN only when roundNumber < 9
    // ACHIEVEMENT → FINAL_SCORING only when roundNumber === 9
    if (from === 'ACHIEVEMENT') {
      if (to === 'OMEN') return this.roundNumber < 9;
      if (to === 'FINAL_SCORING') return this.roundNumber === 9;
    }

    return true;
  }

  /**
   * Transition to the given phase. Throws if the transition is illegal.
   * Automatically increments `roundNumber` when looping from ACHIEVEMENT → OMEN.
   */
  transition(to: GamePhase): void {
    if (!this.canTransition(this.currentPhase, to)) {
      throw new Error(
        `Illegal transition: ${this.currentPhase} → ${to} (round ${this.roundNumber})`,
      );
    }

    // Increment round when cycling back to OMEN
    if (this.currentPhase === 'ACHIEVEMENT' && to === 'OMEN') {
      this.roundNumber += 1;
    }

    this.currentPhase = to;
  }

  /**
   * Returns true when the game has reached the GAME_OVER phase.
   */
  isGameOver(): boolean {
    return this.currentPhase === 'GAME_OVER';
  }
}
