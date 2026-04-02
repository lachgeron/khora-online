import React from 'react';

export interface TimerProps {
  remainingSeconds: number;
  label?: string;
}

/** Countdown timer display. Req 23.1, 23.3 */
export const Timer: React.FC<TimerProps> = ({ remainingSeconds, label }) => {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const isUrgent = remainingSeconds <= 15;

  return (
    <div
      style={{ color: isUrgent ? 'red' : 'inherit', fontWeight: isUrgent ? 'bold' : 'normal' }}
      role="timer"
      aria-live="polite"
      aria-label={label ?? 'Decision timer'}
    >
      {label && <span>{label}: </span>}
      <span>
        {minutes}:{seconds.toString().padStart(2, '0')}
      </span>
    </div>
  );
};
