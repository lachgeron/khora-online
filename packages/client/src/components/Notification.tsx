import React from 'react';
import type { DecisionType } from '../types';

export interface NotificationProps {
  /** The player who needs to act */
  pendingPlayerName: string;
  /** The type of decision awaited */
  decisionType: DecisionType;
  /** Whether the current user is the one who needs to act */
  isCurrentPlayer: boolean;
}

const DECISION_LABELS: Record<DecisionType, string> = {
  SELECT_CITY: 'select a city',
  DRAFT_CARD: 'draft a politics card',
  ROLL_DICE: 'roll their dice',
  ASSIGN_DICE: 'assign dice to actions',
  SPEND_PHILOSOPHY_TOKENS: 'spend philosophy tokens',
  RESOLVE_ACTION: 'resolve an action',
  CHOOSE_LEGISLATION_CARD: 'choose a card to keep',
  CHOOSE_TRADE_BUY: 'decide on a trade purchase',
  CHOOSE_EXPLORATION: 'choose an exploration token',
  CHOOSE_POLITICS_CARD: 'choose a politics card to play',
  CHOOSE_DEVELOPMENT: 'choose a city development',
  PROGRESS_TRACK: 'advance a track',
  ACHIEVEMENT_TRACK_CHOICE: 'choose a track to advance',
  PHASE_DISPLAY: 'view phase results',
  PROSPERITY_POLITICS: 'choose a prosperity politics action',
  ORACLE_CHOOSE_TOKEN: 'choose an oracle token',
  MILITARY_VICTORY_PROGRESS: 'choose a military victory track',
  RISE_OF_PERSIA_PROGRESS: 'choose a track to advance',
  THIRTY_TYRANTS_DISCARD: 'discard a card',
  CONQUEST_ACTION: 'choose a conquest action',
};

/** Decision notification. */
export const Notification: React.FC<NotificationProps> = ({
  pendingPlayerName,
  decisionType,
  isCurrentPlayer,
}) => {
  const actionLabel = DECISION_LABELS[decisionType] ?? decisionType;

  return (
    <div
      role="alert"
      style={{
        padding: '8px',
        border: isCurrentPlayer ? '2px solid orange' : '1px solid #ccc',
        background: isCurrentPlayer ? '#fff3cd' : '#f0f0f0',
      }}
    >
      {isCurrentPlayer ? (
        <strong>Your turn — please {actionLabel}.</strong>
      ) : (
        <span>Waiting for {pendingPlayerName} to {actionLabel}.</span>
      )}
    </div>
  );
};
