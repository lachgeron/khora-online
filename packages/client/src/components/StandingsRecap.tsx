import React from 'react';
import type { PublicGameState } from '../types';
import { motion } from 'framer-motion';

export interface PlayerEffect {
  text: string;
  type: 'gain' | 'loss' | 'action';
}

export interface StandingsRecapProps {
  gameState: PublicGameState;
  currentPlayerId: string;
  /** Per-player effect badges to animate into the card. Key = playerId. */
  playerEffects?: Record<string, PlayerEffect[]>;
  /** Label shown above the standings (e.g. "Round 3 Standings"). */
  title?: string;
  /** Base delay before cards start appearing (seconds). */
  baseDelay?: number;
}

const PROGRESS_TRACKS = [
  { key: 'economyTrack' as const, label: 'Economy', gradient: 'linear-gradient(90deg, #c9a84c, #e0c060)', max: 7 },
  { key: 'cultureTrack' as const, label: 'Culture', gradient: 'linear-gradient(90deg, #7a9450, #96b868)', max: 7 },
  { key: 'militaryTrack' as const, label: 'Military', gradient: 'linear-gradient(90deg, #b85c38, #d47050)', max: 7 },
];

const STATUS_TRACKS = [
  { key: 'taxTrack' as const, label: 'Tax', gradient: 'linear-gradient(90deg, #8b6914, #a88020)', max: 10 },
  { key: 'gloryTrack' as const, label: 'Glory', gradient: 'linear-gradient(90deg, #9060a0, #b080c0)', max: 10 },
  { key: 'troopTrack' as const, label: 'Troops', gradient: 'linear-gradient(90deg, #606878, #808890)', max: 15 },
  { key: 'citizenTrack' as const, label: 'Citizens', gradient: 'linear-gradient(90deg, #4a7a9e, #60a0c8)', max: 15 },
];

export const StandingsRecap: React.FC<StandingsRecapProps> = ({
  gameState,
  currentPlayerId,
  playerEffects = {},
  title,
  baseDelay = 0.5,
}) => {
  const sorted = [...gameState.players].sort((a, b) => b.victoryPoints - a.victoryPoints);
  const effectDelay = baseDelay + sorted.length * 0.15 + 0.4;

  return (
    <div className="mt-5 pt-4 relative">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent to-sand-300" />
        <p className="font-display text-[0.65rem] uppercase tracking-[0.14em] text-sand-400">
          {title ?? `Round ${gameState.roundNumber} Standings`}
        </p>
        <div className="flex-1 h-px bg-gradient-to-l from-transparent to-sand-300" />
      </div>
      <div className="space-y-2.5">
        {sorted.map((p, idx) => {
          const isMe = p.playerId === currentPlayerId;
          const city = gameState.cityCards?.[p.cityId];
          const effects = playerEffects[p.playerId] ?? [];
          const hasAnyEffects = effects.length > 0;

          return (
            <motion.div
              key={p.playerId}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: baseDelay + idx * 0.15, type: 'spring', stiffness: 200, damping: 24 }}
              className="relative"
            >
              {/* The card itself */}
              <div className={`rounded-xl overflow-hidden ${
                isMe
                  ? 'bg-gradient-to-br from-sand-100 to-sand-200 border-2 border-gold/40 shadow-md'
                  : 'bg-gradient-to-br from-sand-50 to-sand-100 border border-sand-200 shadow-sm'
              }`}>
                {/* Header bar */}
                <div className={`flex items-center justify-between px-3.5 py-2 ${
                  isMe ? 'bg-gold/10' : 'bg-sand-200/50'
                }`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[0.55rem] font-bold ${
                      idx === 0 ? 'bg-gold text-sand-900' : 'bg-sand-300 text-sand-600'
                    }`}>{idx + 1}</span>
                    <span className={`text-sm ${isMe ? 'font-bold text-sand-900' : 'font-semibold text-sand-700'}`}>
                      {p.playerName}{isMe ? ' (you)' : ''}
                    </span>
                    {city && <span className="text-[0.6rem] text-sand-400 italic">{city.name}</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className={`text-base font-bold ${idx === 0 ? 'text-gold-dim' : 'text-sand-700'}`}>{p.victoryPoints}</span>
                    <span className="text-[0.55rem] font-semibold text-sand-400 uppercase">vp</span>
                  </div>
                </div>

                <div className="px-3.5 py-2.5">
                  <div className="grid grid-cols-2 gap-x-4">
                    {/* Left: Progress tracks */}
                    <div className="space-y-1.5">
                      <p className="text-[0.5rem] font-bold uppercase tracking-wider text-sand-400 mb-1">Progress</p>
                      {PROGRESS_TRACKS.map(t => (
                        <div key={t.key} className="flex items-center gap-1.5">
                          <span className="text-[0.55rem] font-semibold text-sand-400 w-11 text-right">{t.label}</span>
                          <div className="flex-1 h-1.5 bg-sand-200 rounded-full overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{ background: t.gradient }}
                              initial={{ width: 0 }}
                              animate={{ width: `${(p[t.key] / t.max) * 100}%` }}
                              transition={{ delay: baseDelay + 0.3 + idx * 0.15, duration: 0.6, ease: 'easeOut' }}
                            />
                          </div>
                          <span className="text-[0.55rem] font-bold text-sand-500 w-3 text-right">{p[t.key]}</span>
                        </div>
                      ))}
                    </div>
                    {/* Right: Status tracks */}
                    <div className="space-y-1.5">
                      <p className="text-[0.5rem] font-bold uppercase tracking-wider text-sand-400 mb-1">Status</p>
                      {STATUS_TRACKS.map(t => (
                        <div key={t.key} className="flex items-center gap-1.5">
                          <span className="text-[0.55rem] font-semibold text-sand-400 w-11 text-right">{t.label}</span>
                          <div className="flex-1 h-1.5 bg-sand-200 rounded-full overflow-hidden">
                            <motion.div
                              className="h-full rounded-full"
                              style={{ background: t.gradient }}
                              initial={{ width: 0 }}
                              animate={{ width: `${(p[t.key] / t.max) * 100}%` }}
                              transition={{ delay: baseDelay + 0.3 + idx * 0.15, duration: 0.6, ease: 'easeOut' }}
                            />
                          </div>
                          <span className="text-[0.55rem] font-bold text-sand-500 w-3 text-right">{p[t.key]}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Resources row */}
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[0.6rem]">
                    <span className="text-sand-400"><span className="font-semibold text-sand-600">{p.coins}</span> coins</span>
                    <span className="text-sand-400"><span className="font-semibold text-sand-600">{p.philosophyTokens}</span> scrolls</span>
                    <span className="text-sand-400"><span className="font-semibold text-sand-600">{p.knowledgeTokenCount}</span> tokens</span>
                    <span className="text-sand-400"><span className="font-semibold text-sand-600">{p.handCardCount}</span> cards</span>
                    <span className="text-sand-400">dev <span className="font-semibold text-sand-600">{p.developmentLevel}</span></span>
                  </div>

                  {/* Landing zone for badges */}
                  {hasAnyEffects && <div className="h-7" />}
                </div>
              </div>

              {/* Event effect badges — absolutely positioned, NOT clipped by overflow-hidden */}
              {hasAnyEffects && (
                <div className="absolute bottom-2 left-3.5 right-3.5 flex flex-wrap gap-1.5 z-10">
                  {effects.map((e, i) => (
                    <motion.span
                      key={i}
                      initial={{ y: -120 - idx * 50, opacity: 0, scale: 1.5 }}
                      animate={{ y: 0, opacity: 1, scale: 1 }}
                      transition={{
                        delay: effectDelay + idx * 0.2 + i * 0.1,
                        type: 'spring', stiffness: 200, damping: 16,
                      }}
                      className={`px-2 py-0.5 rounded-full text-[0.6rem] font-bold shadow-sm ${
                        e.type === 'gain'
                          ? 'bg-emerald-100 border border-emerald-300 text-emerald-700'
                          : e.type === 'loss'
                          ? 'bg-red-100 border border-red-300 text-red-700'
                          : 'bg-sand-200 border border-sand-300 text-sand-600'
                      }`}
                      style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}
                    >
                      {e.text}
                    </motion.span>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};
