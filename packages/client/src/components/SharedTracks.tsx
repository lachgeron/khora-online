import React, { useState } from 'react';
import type { PublicPlayerState } from '../types';
import { motion, AnimatePresence } from 'framer-motion';

const PLAYER_COLORS = ['#e06030', '#3080d0', '#40a050', '#9060b0'];

interface SharedTracksProps {
  players: PublicPlayerState[];
  currentPlayerId: string;
}

interface TrackDef {
  key: string;
  label: string;
  icon: string;
  max: number;
  getValue: (p: PublicPlayerState) => number;
  accent: string;
  stripeBg: string;
}

const TRACKS: TrackDef[] = [
  { key: 'citizen', label: 'Citizens', icon: '👤', max: 15, getValue: p => p.citizenTrack, accent: '#4a7a9e', stripeBg: 'rgba(74,122,158,0.08)' },
  { key: 'tax', label: 'Tax', icon: '💰', max: 10, getValue: p => p.taxTrack, accent: '#8b6914', stripeBg: 'rgba(139,105,20,0.08)' },
  { key: 'glory', label: 'Glory', icon: '👑', max: 10, getValue: p => p.gloryTrack, accent: '#9060a0', stripeBg: 'rgba(144,96,160,0.08)' },
  { key: 'troop', label: 'Troops', icon: '🛡', max: 15, getValue: p => p.troopTrack, accent: '#606878', stripeBg: 'rgba(96,104,120,0.08)' },
];

const RAIL_HEIGHT = 240;

export const SharedTracks: React.FC<SharedTracksProps> = ({ players, currentPlayerId }) => {
  const [hoveredTrack, setHoveredTrack] = useState<string | null>(null);

  return (
    <div>
      <div className="flex justify-between gap-1" style={{ minHeight: RAIL_HEIGHT + 50 }}>
        {TRACKS.map(track => (
          <div
            key={track.key}
            className="flex-1 flex flex-col items-center min-w-0 relative"
            onMouseEnter={() => setHoveredTrack(track.key)}
            onMouseLeave={() => setHoveredTrack(null)}
          >
            {/* Icon + label */}
            <span className="text-base mb-0.5">{track.icon}</span>
            <span className="text-[0.55rem] font-display uppercase tracking-wide font-semibold mb-1.5 truncate"
              style={{ color: track.accent }}>{track.label}</span>

            {/* Hover highlight */}
            {hoveredTrack === track.key && (
              <div className="absolute inset-0 rounded-lg border-2 border-sand-400/30 pointer-events-none" style={{ top: '2rem' }} />
            )}

            {/* Vertical rail */}
            <div className="relative w-full rounded-lg overflow-hidden" style={{ height: RAIL_HEIGHT }}>
              {/* Background with horizontal stripes for each level */}
              {Array.from({ length: track.max + 1 }, (_, i) => {
                const bottomPct = (i / track.max) * 100;
                const heightPct = (1 / track.max) * 100;
                return (
                  <div
                    key={i}
                    className="absolute left-0 w-full flex items-center justify-center"
                    style={{
                      bottom: `${bottomPct}%`,
                      height: `${heightPct}%`,
                      background: i % 2 === 0 ? track.stripeBg : 'transparent',
                      borderBottom: '1px solid rgba(0,0,0,0.04)',
                    }}
                  >
                    <span className="text-[0.5rem] font-medium select-none" style={{ color: `${track.accent}50` }}>{i}</span>
                  </div>
                );
              })}

              {/* Accent bar showing the "filled" portion for the current player */}
              {(() => {
                const me = players.find(p => p.playerId === currentPlayerId);
                if (!me) return null;
                const val = track.getValue(me);
                const pct = (val / track.max) * 100;
                return (
                  <motion.div
                    className="absolute bottom-0 left-0 w-full rounded-b-lg opacity-20"
                    style={{ background: track.accent }}
                    initial={{ height: '0%' }}
                    animate={{ height: `${pct}%` }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  />
                );
              })()}

              {/* Player markers */}
              {players.map((p, idx) => {
                const value = track.getValue(p);
                const pct = Math.min(100, (value / track.max) * 100);
                const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
                const isMe = p.playerId === currentPlayerId;

                // Offset horizontally when stacking
                const sameBefore = players.filter((o, oi) => oi < idx && track.getValue(o) === value).length;
                const totalSame = players.filter(o => track.getValue(o) === value).length;
                const spread = totalSame > 1 ? (sameBefore - (totalSame - 1) / 2) * 14 : 0;

                return (
                  <motion.div
                    key={p.playerId}
                    className="absolute"
                    style={{
                      left: `calc(50% + ${spread}px)`,
                      zIndex: isMe ? 10 : 5 - idx,
                    }}
                    initial={{ bottom: '0%' }}
                    animate={{ bottom: `calc(${pct}% - 10px)` }}
                    transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <div
                      className={`flex items-center justify-center rounded-full text-white font-bold shadow-md
                        ${isMe ? 'w-6 h-6 text-[0.55rem] ring-2 ring-offset-1 ring-gold' : 'w-5 h-5 text-[0.5rem]'}`}
                      style={{ background: color, transform: 'translateX(-50%)' }}
                      title={`${p.playerName}: ${value}`}
                    >
                      {p.playerName.charAt(0).toUpperCase()}
                    </div>
                  </motion.div>
                );
              })}

              {/* Top/bottom border accents */}
              <div className="absolute top-0 left-0 w-full h-0.5" style={{ background: track.accent, opacity: 0.3 }} />
              <div className="absolute bottom-0 left-0 w-full h-0.5" style={{ background: track.accent, opacity: 0.3 }} />
            </div>

            {/* Max label at top */}
            <span className="text-[0.5rem] mt-1 font-medium" style={{ color: `${track.accent}80` }}>{track.max}</span>
          </div>
        ))}
      </div>

      {/* Inline detail panel when hovering a track */}
      <AnimatePresence>
        {hoveredTrack && (() => {
          const track = TRACKS.find(t => t.key === hoveredTrack);
          if (!track) return null;
          return (
            <motion.div
              key={hoveredTrack}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="rounded-lg bg-sand-800 text-sand-100 px-4 py-2.5 mt-2">
                <p className="text-[0.6rem] font-display uppercase tracking-wider text-sand-400 mb-1.5">{track.label} — All Players</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {[...players]
                    .sort((a, b) => track.getValue(b) - track.getValue(a))
                    .map((p) => {
                      const origIdx = players.findIndex(o => o.playerId === p.playerId);
                      const isMe = p.playerId === currentPlayerId;
                      return (
                        <div key={p.playerId} className="flex items-center gap-1.5 text-xs">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PLAYER_COLORS[origIdx % PLAYER_COLORS.length] }} />
                          <span className={`flex-1 truncate ${isMe ? 'font-bold text-sand-100' : 'text-sand-300'}`}>{p.playerName}</span>
                          <span className="font-bold text-sm">{track.getValue(p)}</span>
                          <span className="text-[0.55rem] text-sand-500">/ {track.max}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 justify-center mt-3 pt-2 border-t border-sand-200">
        {players.map((p, idx) => (
          <div key={p.playerId} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full shadow-sm" style={{ background: PLAYER_COLORS[idx % PLAYER_COLORS.length] }} />
            <span className={`text-[0.65rem] ${p.playerId === currentPlayerId ? 'font-bold text-sand-800' : 'text-sand-500'}`}>
              {p.playerName}{p.playerId === currentPlayerId ? ' (you)' : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
