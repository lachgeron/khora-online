/**
 * ActionResolver interface — shared contract for all 7 action resolvers.
 *
 * Each action type (Philosophy through Development) implements this interface
 * to encapsulate its resolution logic. Actions are numbered 0–6.
 */

import type {
  ActionChoices,
  ActionCostResult,
  ActionType,
  GameError,
  GameState,
  Result,
} from '@khora/shared';

export interface ActionResolver {
  readonly actionNumber: number; // 0–6
  readonly actionType: ActionType;

  /** Check whether the player can perform this action given the die value. */
  canPerform(state: GameState, playerId: string, dieValue: number): ActionCostResult;

  /** Resolve the action, applying its effects to the game state. */
  resolve(state: GameState, playerId: string, choices: ActionChoices): Result<GameState, GameError>;
}
