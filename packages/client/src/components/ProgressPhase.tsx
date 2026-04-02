import React, { useState } from 'react';
import { motion } from 'framer-motion';
import type { ProgressTrackType, TrackAdvancement } from '../types';
import { CountdownTimer } from './CountdownTimer';

export interface ProgressPhaseProps {
  economyTrack: number;
  cultureTrack: number;
  militaryTrack: number;
  coins: number;
  philosophyTokens: number;
  pendingDecisions: { playerId: string; decisionType: string; timeoutAt: number }[];
  currentPlayerId: string;
  playedCardIds?: string[];
  onAdvance: (advancement: TrackAdvancement, extraTracks?: TrackAdvancement[], bonusTracks?: TrackAdvancement[]) => void;
  onUndo: () => void;
  onSkip: () => void;
}

const ECONOMY_COSTS: Record<number, number> = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 };
const CULTURE_COSTS: Record<number, number> = { 1: 1, 2: 4, 3: 6, 4: 6, 5: 7, 6: 7 };
const MILITARY_COSTS: Record<number, number> = { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9 };
const TRACK_COSTS: Record<string, Record<number, number>> = {
  ECONOMY: ECONOMY_COSTS,
  CULTURE: CULTURE_COSTS,
  MILITARY: MILITARY_COSTS,
};
const MAX = 7;

const TRACK_INFO: { type: ProgressTrackType; label: string; icon: string; color: string }[] = [
  { type: 'ECONOMY', label: 'Economy', icon: '🏛', color: '#c9a84c' },
  { type: 'CULTURE', label: 'Culture', icon: '🎭', color: '#7a9450' },
  { type: 'MILITARY', label: 'Military', icon: '⚔️', color: '#b85c38' },
];

export const ProgressPhase: React.FC<ProgressPhaseProps> = ({
  economyTrack, cultureTrack, militaryTrack, coins, philosophyTokens,
  pendingDecisions, currentPlayerId, playedCardIds, onAdvance, onUndo, onSkip,
}) => {
  const hasPending = pendingDecisions.some(d => d.playerId === currentPlayerId);
  const [primary, setPrimary] = useState<ProgressTrackType | null>(null);
  const [bonus, setBonus] = useState<ProgressTrackType | null>(null);
  const [extras, setExtras] = useState<(ProgressTrackType | null)[]>([]);

  const hasMint = playedCardIds?.includes('constructing-the-mint') ?? false;
  const hasReformists = playedCardIds?.includes('reformists') ?? false;
  const hasGradualism = playedCardIds?.includes('gradualism') ?? false;

  const getLevel = (t: ProgressTrackType) => t === 'ECONOMY' ? economyTrack : t === 'CULTURE' ? cultureTrack : militaryTrack;

  const getEffective = (t: ProgressTrackType, upTo: number) => {
    let lvl = getLevel(t);
    if (primary === t) lvl++;
    if (bonus === t) lvl++;
    for (let i = 0; i < upTo; i++) if (extras[i] === t) lvl++;
    return lvl;
  };

  const getEffectiveForBonus = (t: ProgressTrackType) => {
    let lvl = getLevel(t);
    if (primary === t) lvl++;
    return lvl;
  };

  const getTrackCost = (t: ProgressTrackType, level: number) => {
    if (t === 'ECONOMY' && hasMint) return 0;
    let cost = (TRACK_COSTS[t] ?? {})[level] ?? 99;
    if (cost > 0 && hasGradualism) cost = Math.max(0, cost - 1);
    return cost;
  };

  const getCostAt = (t: ProgressTrackType, upTo: number) => getTrackCost(t, getEffective(t, upTo));

  const primaryCost = primary ? getTrackCost(primary, getLevel(primary)) : 0;
  const bonusCost = bonus ? getTrackCost(bonus, getEffectiveForBonus(bonus)) : 0;
  let totalCost = primaryCost + bonusCost;
  for (let i = 0; i < extras.length; i++) {
    if (extras[i]) totalCost += getCostAt(extras[i]!, i);
  }
  const philCost = extras.length;
  const allExtrasSelected = extras.every(e => e !== null);
  const canAfford = coins >= totalCost && philosophyTokens >= philCost;
  const canSubmit = primary !== null && canAfford && allExtrasSelected;

  // ── LOCKED IN ──
  if (!hasPending) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h3 className="font-display text-lg font-bold text-sand-800 mb-3">📈 Progress — Locked In</h3>
        <p className="text-sm text-sand-500 mb-3">Your selections have been submitted.</p>
        {pendingDecisions.length > 0 && (
          <p className="text-xs text-sand-400 mb-3">Waiting for other players...</p>
        )}
        <button
          onClick={() => { setPrimary(null); setBonus(null); setExtras([]); onUndo(); }}
          className="w-full py-2 text-sand-500 text-xs font-medium border border-sand-300 rounded-lg hover:bg-sand-100 transition-colors"
        >
          Change Selection
        </button>
      </motion.div>
    );
  }

  // ── SELECTION ──
  const handleSubmit = () => {
    if (!primary) return;
    const validExtras = extras.filter((e): e is ProgressTrackType => e !== null).map(t => ({ track: t }));
    const validBonus = bonus ? [{ track: bonus }] : undefined;
    onAdvance({ track: primary }, validExtras.length > 0 ? validExtras : undefined, validBonus);
  };

  const TrackButton: React.FC<{
    track: ProgressTrackType; label: string; icon: string; color: string;
    level: number; cost: number; isSelected: boolean; onSelect: () => void;
  }> = ({ track, label, icon, color, level, cost, isSelected, onSelect }) => {
    const atMax = level >= MAX;
    return (
      <button
        disabled={atMax}
        onClick={onSelect}
        className={`flex items-center gap-3 w-full rounded-lg border-2 px-4 py-3 transition-all text-left ${
          isSelected
            ? 'border-gold bg-gold/5 shadow-sm'
            : atMax
            ? 'border-sand-200 bg-sand-100 opacity-40 cursor-not-allowed'
            : 'border-sand-200 bg-sand-50 hover:border-sand-400'
        }`}
      >
        <span className="text-xl">{icon}</span>
        <div className="flex-1">
          <span className="text-sm font-semibold" style={{ color }}>{label}</span>
          <span className="text-xs text-sand-500 ml-2">Lv {level} → {level + 1}</span>
        </div>
        <span className={`text-sm font-bold ${isSelected ? 'text-gold-dim' : 'text-sand-500'}`}>
          {atMax ? 'MAX' : `${cost} 💰`}
        </span>
      </button>
    );
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-center gap-3 mb-1">
        <h3 className="font-display text-lg font-bold text-sand-800">📈 Progress Phase</h3>
        {hasPending && (() => {
          const myDecision = pendingDecisions.find(d => d.playerId === currentPlayerId);
          return myDecision ? <CountdownTimer timeoutAt={myDecision.timeoutAt} /> : null;
        })()}
      </div>

      {/* Resources */}
      <div className="flex gap-3 mb-4 text-xs text-sand-600">
        <span>💰 <span className="font-bold text-sand-800">{coins}</span></span>
        <span>📜 <span className="font-bold text-sand-800">{philosophyTokens}</span></span>
      </div>

      {/* Primary track selection */}
      <p className="text-xs font-medium text-sand-600 mb-2">Advance one track:</p>
      <div className="space-y-2 mb-4">
        {TRACK_INFO.map(t => (
          <TrackButton
            key={t.type}
            track={t.type} label={t.label} icon={t.icon} color={t.color}
            level={getLevel(t.type)}
            cost={getTrackCost(t.type, getLevel(t.type))}
            isSelected={primary === t.type}
            onSelect={() => setPrimary(primary === t.type ? null : t.type)}
          />
        ))}
      </div>

      {/* Reformists bonus advancement (free, no philosophy token) */}
      {hasReformists && primary && (
        <div className="mb-4 pl-3 border-l-2 border-gold">
          <p className="text-xs font-medium text-gold-dim mb-2">Reformists — bonus advancement (free):</p>
          <div className="space-y-1.5">
            {TRACK_INFO.map(t => {
              const lvl = getEffectiveForBonus(t.type);
              const cost = getTrackCost(t.type, lvl);
              return (
                <TrackButton
                  key={t.type}
                  track={t.type} label={t.label} icon={t.icon} color={t.color}
                  level={lvl} cost={cost}
                  isSelected={bonus === t.type}
                  onSelect={() => setBonus(bonus === t.type ? null : t.type)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Extra advancements via philosophy tokens */}
      {extras.map((et, i) => (
        <div key={i} className="mb-3 pl-3 border-l-2 border-purple-300">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-purple-700">Extra advancement #{i + 1} (1 📜)</p>
            <button
              onClick={() => setExtras(extras.filter((_, j) => j !== i))}
              className="text-xs text-sand-400 hover:text-red-500 transition-colors"
            >
              Remove
            </button>
          </div>
          <div className="space-y-1.5">
            {TRACK_INFO.map(t => {
              const lvl = getEffective(t.type, i);
              const cost = getCostAt(t.type, i);
              return (
                <TrackButton
                  key={t.type}
                  track={t.type} label={t.label} icon={t.icon} color={t.color}
                  level={lvl} cost={cost}
                  isSelected={et === t.type}
                  onSelect={() => { const e = [...extras]; e[i] = et === t.type ? null : t.type; setExtras(e); }}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* Add extra button */}
      {primary && philosophyTokens > extras.length && (
        <button
          onClick={() => setExtras([...extras, null])}
          className="w-full py-2 mb-4 text-xs font-medium text-purple-600 border border-purple-200 rounded-lg hover:bg-purple-50 transition-colors"
        >
          + Spend 1 📜 for extra advancement
        </button>
      )}

      {/* Cost summary */}
      {primary && (
        <div className="rounded-lg bg-sand-100 px-3 py-2 mb-4 text-xs text-sand-600">
          Total: <span className="font-bold text-sand-800">{totalCost} 💰</span>
          {philCost > 0 && <span> + <span className="font-bold text-purple-700">{philCost} 📜</span></span>}
          {!canAfford && <span className="text-red-600 font-bold ml-2">Not enough resources</span>}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <motion.button
          whileHover={canSubmit ? { scale: 1.02 } : {}}
          whileTap={canSubmit ? { scale: 0.98 } : {}}
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="flex-1 py-3 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Confirm
        </motion.button>
        <button
          onClick={onSkip}
          className="px-4 py-3 text-sand-500 text-sm font-medium border border-sand-300 rounded-lg hover:bg-sand-100 transition-colors"
        >
          Skip
        </button>
      </div>
    </motion.div>
  );
};
