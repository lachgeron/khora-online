import React from 'react';
import type { GamePhase } from '../types';

export interface PhaseIndicatorProps {
  currentPhase: GamePhase;
  roundNumber: number;
}

const PHASE_LABELS: Record<string, string> = {
  LOBBY: 'Lobby',
  CITY_SELECTION: 'City Selection',
  DRAFT_POLITICS: 'Draft Politics',
  OMEN: 'Omen',
  TAXATION: 'Taxation',
  DICE: 'Dice',
  ACTIONS: 'Actions',
  PROGRESS: 'Progress',
  GLORY: 'Glory',
  ACHIEVEMENT: 'Achievement',
  FINAL_SCORING: 'Final Scoring',
  GAME_OVER: 'Game Over',
};

/** Displays current phase and round number. Req 19.2 */
export const PhaseIndicator: React.FC<PhaseIndicatorProps> = ({
  currentPhase,
  roundNumber,
}) => {
  return (
    <div>
      <span>Round {roundNumber}/9</span>
      {' — '}
      <span>{PHASE_LABELS[currentPhase] ?? currentPhase}</span>
    </div>
  );
};
