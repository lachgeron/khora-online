import React, { useRef, useEffect } from 'react';
import type { GameLogEntry } from '../types';

const PLAYER_COLORS = ['#e06030', '#3080d0', '#40a050', '#9060b0'];

export interface GameLogProps {
  entries: GameLogEntry[];
  playerNames?: Record<string, string>;
  playerOrder?: string[]; // for consistent color assignment
}

export const GameLog: React.FC<GameLogProps> = ({ entries, playerNames, playerOrder }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  const getName = (id: string | null) => {
    if (!id) return null;
    return playerNames?.[id] ?? id;
  };

  const getColor = (id: string | null) => {
    if (!id || !playerOrder) return undefined;
    const idx = playerOrder.indexOf(id);
    return idx >= 0 ? PLAYER_COLORS[idx % PLAYER_COLORS.length] : undefined;
  };

  return (
    <div>
      <p className="font-display text-[0.65rem] uppercase tracking-[0.12em] text-sand-600 mb-2">Game Log</p>
      <div
        ref={scrollRef}
        className="max-h-48 overflow-y-auto space-y-0.5"
        role="log"
        aria-live="polite"
      >
        {entries.length === 0 && (
          <p className="text-xs text-sand-400 italic">No events yet.</p>
        )}
        {entries.map((entry, i) => {
          const name = getName(entry.playerId);
          const color = getColor(entry.playerId);
          return (
            <div key={i} className="text-[0.7rem] leading-snug text-sand-600">
              <span className="text-sand-400 mr-1">R{entry.roundNumber}</span>
              {name && (
                <span className="font-semibold mr-1" style={{ color }}>
                  {name}:
                </span>
              )}
              {entry.action}
            </div>
          );
        })}
      </div>
    </div>
  );
};
