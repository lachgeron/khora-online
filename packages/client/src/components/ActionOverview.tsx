import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PublicGameState, ActionType, GameLogEntry } from '../types';
import { ACTION_NUMBERS } from '../types';

const ACTION_INFO: Record<ActionType, { icon: string; label: string; color: string }> = {
  PHILOSOPHY: { icon: '📜', label: 'Philosophy', color: '#9060a0' },
  LEGISLATION: { icon: '📋', label: 'Legislation', color: '#4a7a9e' },
  CULTURE: { icon: '🎭', label: 'Culture', color: '#7a9450' },
  TRADE: { icon: '💰', label: 'Trade', color: '#c9a84c' },
  MILITARY: { icon: '⚔️', label: 'Military', color: '#b85c38' },
  POLITICS: { icon: '🏛', label: 'Politics', color: '#606878' },
  DEVELOPMENT: { icon: '🔨', label: 'Development', color: '#8b6914' },
};

const PLAYER_COLORS = ['#e06030', '#3080d0', '#40a050', '#9060b0'];

interface ActionOverviewProps {
  gameState: PublicGameState;
  currentPlayerId: string;
}

/**
 * Extract gains from game log entries for a specific player's action resolution.
 * Returns an array of short gain strings like "+3 drachma", "+2 VP", etc.
 */
function getActionGains(
  gameLog: GameLogEntry[],
  roundNumber: number,
  playerId: string,
  actionType: ActionType,
): string[] {
  // Find the diff log entry that follows the "Resolved X" entry for this action
  const actionEntries = gameLog.filter(
    e => e.roundNumber === roundNumber
      && e.phase === 'ACTIONS'
      && e.playerId === playerId,
  );

  // Look for entries whose source matches the action type (from logPlayerDiff)
  const diffEntry = actionEntries.find(
    e => e.details?.source === actionType && Array.isArray(e.details?.changes),
  );

  if (diffEntry && Array.isArray(diffEntry.details.changes)) {
    return diffEntry.details.changes as string[];
  }

  return [];
}

export const ActionOverview: React.FC<ActionOverviewProps> = ({ gameState, currentPlayerId }) => {
  const pendingPlayerIds = new Set(
    gameState.pendingDecisions
      .filter(d => d.decisionType === 'RESOLVE_ACTION')
      .map(d => d.playerId),
  );

  return (
    <div className="space-y-2">
      <p className="font-display text-[0.65rem] uppercase tracking-[0.12em] text-sand-500">
        Action Overview
      </p>

      {gameState.players.map((player, pIdx) => {
        const isMe = player.playerId === currentPlayerId;
        const isActive = pendingPlayerIds.has(player.playerId);
        const color = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];
        const slots = [...player.actionSlots].sort(
          (a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType],
        );
        const allDone = slots.length > 0 && slots.every(s => s.resolved);

        return (
          <motion.div
            key={player.playerId}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: pIdx * 0.05 }}
            className={`rounded-lg border px-3 py-2 ${
              isActive
                ? 'border-amber-300 bg-amber-50/40'
                : allDone
                ? 'border-emerald-200 bg-emerald-50/30'
                : 'border-sand-200 bg-sand-50/50'
            }`}
          >
            {/* Player header */}
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: color }}
              />
              <span className={`text-[0.7rem] font-semibold ${isMe ? 'text-sand-800' : 'text-sand-600'}`}>
                {player.playerName}{isMe ? ' (you)' : ''}
              </span>
              {isActive && (
                <span className="ml-auto text-[0.55rem] px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-800 font-bold animate-pulse">
                  Resolving
                </span>
              )}
              {allDone && (
                <span className="ml-auto text-[0.55rem] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold">
                  Done
                </span>
              )}
            </div>

            {/* Action tiles with gains */}
            <div className="space-y-1">
              {slots.map((slot, i) => {
                const info = ACTION_INFO[slot.actionType];
                const gains = slot.resolved
                  ? getActionGains(gameState.gameLog, gameState.roundNumber, player.playerId, slot.actionType)
                  : [];

                return (
                  <div key={i} className="flex items-start gap-2">
                    {/* Action tile */}
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[0.6rem] font-medium shrink-0 transition-all ${
                        slot.resolved
                          ? 'bg-emerald-100 text-emerald-700'
                          : isActive && !slot.resolved && i === slots.findIndex(s => !s.resolved)
                          ? 'bg-gold/20 text-gold-dim ring-1 ring-gold/40'
                          : 'bg-sand-100 text-sand-500'
                      }`}
                    >
                      {info.icon} {info.label}
                      {slot.resolved && ' ✓'}
                    </span>

                    {/* Gains from resolving */}
                    <AnimatePresence>
                      {gains.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, x: -4 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex flex-wrap gap-1 items-center"
                        >
                          {gains.map((gain, gi) => (
                            <span
                              key={gi}
                              className="text-[0.55rem] text-sand-600 bg-sand-100 px-1.5 py-0.5 rounded"
                            >
                              {gain}
                            </span>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
              {slots.length === 0 && (
                <span className="text-[0.6rem] text-sand-400 italic">No actions</span>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};
