import type { ClientMessage } from './messages';
import type { DecisionType, GamePhase } from './enums';

export interface ScoreSolverMove {
  playerId: string;
  playerName: string;
  round: number;
  phase: GamePhase;
  decision: DecisionType | 'ACTIVATE_DEV';
  message: ClientMessage;
  instruction: string;
}

export interface ScoreSolverResult {
  requestId: string;
  status: 'SEARCHING' | 'PAUSED' | 'ERROR';
  immediateMove: ScoreSolverMove | null;
  path: ScoreSolverMove[];
  projectedScore: number | null;
  completedRollouts: number;
  evaluatedMoves: number;
  elapsedMs: number;
  message: string;
  assumesFutureDraftDraws: boolean;
}
