import React from 'react';
import { motion } from 'framer-motion';
import type { PublicGameState, PrivatePlayerState, ActionType } from '../types';
import { ACTION_NUMBERS } from '../types';

const ACTION_INFO: Record<ActionType, { icon: string; label: string }> = {
  PHILOSOPHY: { icon: '📜', label: 'Philosophy' },
  LEGISLATION: { icon: '📋', label: 'Legislation' },
  CULTURE: { icon: '🎭', label: 'Culture' },
  TRADE: { icon: '💰', label: 'Trade' },
  MILITARY: { icon: '⚔️', label: 'Military' },
  POLITICS: { icon: '🏛', label: 'Politics' },
  DEVELOPMENT: { icon: '🔨', label: 'Development' },
};

const PLAYER_COLORS = ['#e06030', '#3080d0', '#40a050', '#9060b0'];

interface WaitingPanelProps {
  gameState: PublicGameState;
  privateState: PrivatePlayerState;
  currentPlayerId: string;
}

export const WaitingPanel: React.FC<WaitingPanelProps> = ({ gameState, privateState, currentPlayerId }) => {
  const phase = gameState.currentPhase;

  if (phase !== 'ACTIONS') {
    const waitingNames = gameState.pendingDecisions
      .filter(d => d.playerId !== currentPlayerId)
      .map(d => gameState.players.find(p => p.playerId === d.playerId)?.playerName ?? d.playerId);
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-4">
        <p className="text-sm text-sand-600">{phase.replace(/_/g, ' ')}</p>
        {waitingNames.length > 0 && <p className="text-xs text-sand-400 mt-1">Waiting for {waitingNames.join(', ')}...</p>}
      </motion.div>
    );
  }

  // ── ACTIONS phase waiting view ──
  const pendingPlayerIds = new Set(gameState.pendingDecisions.filter(d => d.decisionType === 'RESOLVE_ACTION').map(d => d.playerId));
  const mySlots = privateState.actionSlots.filter((s): s is NonNullable<typeof s> => s !== null);
  const myResolved = mySlots.filter(s => s.resolved);
  const myUnresolved = mySlots.filter(s => !s.resolved).sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h3 className="font-display text-base font-bold text-sand-800 mb-3">⏳ Action Resolution</h3>

      {/* All players' action selections and status */}
      <div className="space-y-3 mb-4">
        {gameState.players.map((p, pIdx) => {
          const isMe = p.playerId === currentPlayerId;
          const isWaiting = pendingPlayerIds.has(p.playerId);
          const color = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];
          const slots = isMe
            ? mySlots.map(s => ({ actionType: s.actionType, resolved: s.resolved }))
            : p.actionSlots;

          return (
            <div key={p.playerId} className={`rounded-lg border px-3 py-2.5 ${
              isWaiting ? 'border-amber-300 bg-amber-50/50' : 'border-sand-200 bg-sand-50'
            }`}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: color }} />
                <span className={`text-xs font-semibold ${isMe ? 'text-sand-800' : 'text-sand-600'}`}>
                  {p.playerName}{isMe ? ' (you)' : ''}
                </span>
                {isWaiting && (
                  <span className="ml-auto text-[0.6rem] px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-800 font-bold animate-pulse">
                    Resolving...
                  </span>
                )}
                {!isWaiting && slots.every(s => s.resolved) && slots.length > 0 && (
                  <span className="ml-auto text-[0.6rem] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">
                    Done
                  </span>
                )}
              </div>

              {/* Player's action slots */}
              <div className="flex flex-wrap gap-1">
                {slots
                  .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType])
                  .map((slot, i) => {
                    const info = ACTION_INFO[slot.actionType];
                    return (
                      <span
                        key={i}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[0.65rem] font-medium ${
                          slot.resolved
                            ? 'bg-emerald-100 text-emerald-700 line-through'
                            : isWaiting && i === 0
                            ? 'bg-gold/20 text-gold-dim ring-1 ring-gold/40'
                            : 'bg-sand-100 text-sand-600'
                        }`}
                      >
                        {info.icon} {info.label}
                        {slot.resolved && ' ✓'}
                      </span>
                    );
                  })}
                {slots.length === 0 && (
                  <span className="text-[0.65rem] text-sand-400 italic">No actions assigned</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Your status */}
      {myResolved.length > 0 && (
        <div className="mb-3">
          <p className="text-[0.6rem] font-display uppercase tracking-[0.12em] text-sand-500 mb-1">Your completed</p>
          <div className="flex flex-wrap gap-1">
            {myResolved.map(s => (
              <span key={s.actionType} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-[0.65rem] text-emerald-700 font-medium">
                {ACTION_INFO[s.actionType].icon} {ACTION_INFO[s.actionType].label}
              </span>
            ))}
          </div>
        </div>
      )}

      {myUnresolved.length > 0 && (
        <div>
          <p className="text-[0.6rem] font-display uppercase tracking-[0.12em] text-sand-500 mb-1">Still to come</p>
          <div className="flex flex-wrap gap-1">
            {myUnresolved.map(s => (
              <span key={s.actionType} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sand-100 border border-sand-200 text-[0.65rem] text-sand-600 font-medium">
                {ACTION_INFO[s.actionType].icon} {ACTION_INFO[s.actionType].label}
              </span>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
};
