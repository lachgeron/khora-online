import React, { useState, useEffect } from 'react';

export interface CountdownTimerProps {
  timeoutAt: number;
  label?: string;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({ timeoutAt, label }) => {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((timeoutAt - Date.now()) / 1000)));

  useEffect(() => {
    setRemaining(Math.max(0, Math.ceil((timeoutAt - Date.now()) / 1000)));
    const interval = setInterval(() => {
      const r = Math.max(0, Math.ceil((timeoutAt - Date.now()) / 1000));
      setRemaining(r);
      if (r <= 0) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [timeoutAt]);

  const isUrgent = remaining <= 5;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const display = minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;

  return (
    <div
      role="timer"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
        isUrgent
          ? 'bg-red-100 text-red-700 animate-pulse'
          : 'bg-sand-200 text-sand-700'
      }`}
    >
      <span>⏱</span>
      {label && <span>{label}</span>}
      <span>{display}</span>
    </div>
  );
};
