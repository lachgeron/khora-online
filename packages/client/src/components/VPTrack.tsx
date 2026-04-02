import React from 'react';
import type { PublicPlayerState } from '../types';
import { motion } from 'framer-motion';

const PLAYER_COLORS = ['#e06030', '#3080d0', '#40a050', '#9060b0'];
const VP_MAX = 250;

interface VPTrackProps {
  players: PublicPlayerState[];
  currentPlayerId: string;
}

export const VPTrack: React.FC<VPTrackProps> = ({ players, currentPlayerId }) => {
  // Sort players by VP descending for the leaderboard
  const sorted = [...players].sort((a, b) => b.victoryPoints - a.victoryPoints);
  const maxVP = Math.max(...players.map(p => p.victoryPoints), 1);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-[0.6rem] uppercase tracking-[0.12em] text-sand-500 font-semibold">Victory Points</span>
        <span className="text-[0.55rem] text-sand-400">/ {VP_MAX}</span>
      </div>

      <div className="space-y-1.5">
        {sorted.map((p, sortIdx) => {
          const origIdx = players.findIndex(o => o.playerId === p.playerId);
          const color = PLAYER_COLORS[origIdx % PLAYER_COLORS.length];
          const isMe = p.playerId === currentPlayerId;
          const pct = Math.min(100, (p.victoryPoints / VP_MAX) * 100);

          return (
            <div key={p.playerId} className="flex items-center gap-2">
              <span className={`w-14 text-[0.65rem] truncate ${isMe ? 'font-bold text-sand-800' : 'text-sand-500'}`}>
                {p.playerName}
              </span>
              <div className="flex-1 h-5 bg-sand-200 rounded-full relative overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(2, pct)}%` }}
                  transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
              <span className={`w-8 text-right text-xs font-bold ${isMe ? 'text-sand-800' : 'text-sand-600'}`}>
                {p.victoryPoints}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
