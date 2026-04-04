import React, { useState, useEffect, useRef } from 'react';

export interface CountdownTimerProps {
  timeoutAt: number;
  label?: string;
  onExpire?: () => void;
}

export const CountdownTimer: React.FC<CountdownTimerProps> = ({ timeoutAt, label, onExpire }) => {
  const totalRef = useRef(Math.max(1, Math.ceil((timeoutAt - Date.now()) / 1000)));
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((timeoutAt - Date.now()) / 1000)));
  const expiredRef = useRef(false);

  useEffect(() => {
    const total = Math.max(1, Math.ceil((timeoutAt - Date.now()) / 1000));
    totalRef.current = total;
    expiredRef.current = false;
    setRemaining(total);
    const interval = setInterval(() => {
      const r = Math.max(0, Math.ceil((timeoutAt - Date.now()) / 1000));
      setRemaining(r);
      if (r <= 0) {
        clearInterval(interval);
        if (!expiredRef.current && onExpire) {
          expiredRef.current = true;
          onExpire();
        }
      }
    }, 250);
    return () => clearInterval(interval);
  }, [timeoutAt, onExpire]);

  const isUrgent = remaining <= 5;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const display = minutes > 0 ? `${minutes}:${seconds.toString().padStart(2, '0')}` : `${seconds}s`;
  const pct = Math.max(0, Math.min(100, (remaining / totalRef.current) * 100));

  return (
    <div role="timer" aria-live="polite" className="w-full">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-bold ${isUrgent ? 'text-red-600 animate-pulse' : 'text-sand-600'}`}>
          ⏱ {label ? `${label} ` : ''}{display}
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-sand-200 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-linear ${
            isUrgent ? 'bg-red-500' : pct > 50 ? 'bg-emerald-500' : 'bg-amber-500'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
