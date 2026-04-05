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

interface TimelineEntry {
  playerId: string;
  playerName: string;
  playerIndex: number;
  actionType: ActionType;
  resolved: boolean;
}

interface ActionOverviewProps {
  gameState: PublicGameState;
  currentPlayerId: string;
}

/**
 * Extract gains from game log for a player's resolved action.
 */
function getActionGains(
  gameLog: GameLogEntry[],
  roundNumber: number,
  playerId: string,
  actionType: ActionType,
): string[] {
  const diffEntry = gameLog.find(
    e => e.roundNumber === roundNumber
      && e.phase === 'ACTIONS'
      && e.playerId === playerId
      && e.details?.source === actionType
      && Array.isArray(e.details?.changes),
  );
  return diffEntry ? (diffEntry.details.changes as string[]) : [];
}

/**
 * Build the full timeline of actions in resolution order.
 * In Khora, each player resolves ALL their actions (ascending cost) before the next player.
 * Turn order comes from gameState.turnOrder.
 */
function buildTimeline(gameState: PublicGameState): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const pid of gameState.turnOrder) {
    const pIdx = gameState.players.findIndex(p => p.playerId === pid);
    const player = gameState.players[pIdx];
    if (!player) continue;

    const slots = [...player.actionSlots]
      .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType]);

    for (const slot of slots) {
      entries.push({
        playerId: player.playerId,
        playerName: player.playerName,
        playerIndex: pIdx,
        actionType: slot.actionType,
        resolved: slot.resolved,
      });
    }
  }
  return entries;
}

/**
 * Find the index of the currently-active entry in the timeline.
 */
function findActiveIndex(
  timeline: TimelineEntry[],
  pendingPlayerId: string | null,
): number {
  if (!pendingPlayerId) return -1;
  return timeline.findIndex(
    e => e.playerId === pendingPlayerId && !e.resolved,
  );
}

export const ActionOverview: React.FC<ActionOverviewProps> = ({ gameState, currentPlayerId }) => {
  const timeline = buildTimeline(gameState);
  const pendingDecision = gameState.pendingDecisions.find(d => d.decisionType === 'RESOLVE_ACTION');
  const activePlayerId = pendingDecision?.playerId ?? null;
  const activeIndex = findActiveIndex(timeline, activePlayerId);

  // Group consecutive entries by player for visual grouping
  const groups: { playerId: string; playerName: string; playerIndex: number; entries: (TimelineEntry & { timelineIndex: number })[] }[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const entry = timeline[i];
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.playerId === entry.playerId) {
      lastGroup.entries.push({ ...entry, timelineIndex: i });
    } else {
      groups.push({
        playerId: entry.playerId,
        playerName: entry.playerName,
        playerIndex: entry.playerIndex,
        entries: [{ ...entry, timelineIndex: i }],
      });
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="font-display text-[0.65rem] uppercase tracking-[0.12em] text-sand-500 mb-1">
        Action Timeline
      </p>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {groups.map((group, gIdx) => {
          const color = PLAYER_COLORS[group.playerIndex % PLAYER_COLORS.length];
          const isMe = group.playerId === currentPlayerId;
          const isActiveGroup = group.playerId === activePlayerId;
          const allDone = group.entries.every(e => e.resolved);

          return (
            <div
              key={`${group.playerId}-${gIdx}`}
              className={`shrink-0 rounded-lg border px-2 py-1.5 min-w-[100px] ${
                isActiveGroup
                  ? 'border-amber-300 bg-amber-50/60'
                  : allDone
                  ? 'border-sand-200 bg-sand-50/40'
                  : 'border-sand-200 bg-sand-50/60'
              }`}
            >
              {/* Player name header */}
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: color }}
                />
                <span className={`text-[0.6rem] font-semibold truncate ${
                  isMe ? 'text-sand-800' : 'text-sand-600'
                }`}>
                  {isMe ? 'You' : group.playerName}
                </span>
                {isActiveGroup && (
                  <span className="text-[0.5rem] px-1 py-0.5 rounded bg-amber-200 text-amber-800 font-bold animate-pulse shrink-0">
                    ▶
                  </span>
                )}
                {allDone && (
                  <span className="text-[0.5rem] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold shrink-0">
                    ✓
                  </span>
                )}
              </div>

              {/* Action tiles */}
              <div className="space-y-1">
                {group.entries.map((entry) => {
                  const info = ACTION_INFO[entry.actionType];
                  const isCurrentAction = entry.timelineIndex === activeIndex;
                  const gains = entry.resolved
                    ? getActionGains(gameState.gameLog, gameState.roundNumber, entry.playerId, entry.actionType)
                    : [];

                  return (
                    <div key={entry.timelineIndex}>
                      <div
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.6rem] font-medium transition-all ${
                          entry.resolved
                            ? 'bg-sand-200/60 text-sand-400'
                            : isCurrentAction
                            ? 'ring-2 ring-gold/60 bg-gold/15 text-sand-800'
                            : 'bg-sand-100 text-sand-500'
                        }`}
                      >
                        <span>{info.icon}</span>
                        <span className={entry.resolved ? 'line-through' : ''}>
                          {info.label}
                        </span>
                        {entry.resolved && <span className="ml-auto text-emerald-500">✓</span>}
                      </div>

                      {/* Gains under resolved action */}
                      <AnimatePresence>
                        {gains.length > 0 && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            className="overflow-hidden pl-1 mt-0.5"
                          >
                            {gains.map((gain, gi) => (
                              <p key={gi} className="text-[0.5rem] text-sand-500 leading-tight">
                                {gain}
                              </p>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
