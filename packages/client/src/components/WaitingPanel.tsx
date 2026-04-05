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

  // ── ACTIONS phase waiting view (brief — detailed overview is in sidebar) ──
  const mySlots = privateState.actionSlots.filter((s): s is NonNullable<typeof s> => s !== null);
  const myUnresolved = mySlots.filter(s => !s.resolved).sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType]);
  const activePlayer = gameState.pendingDecisions.find(d => d.decisionType === 'RESOLVE_ACTION');
  const activePlayerName = activePlayer
    ? gameState.players.find(p => p.playerId === activePlayer.playerId)?.playerName ?? '...'
    : null;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-3">
      {activePlayer && activePlayer.playerId !== currentPlayerId && (
        <p className="text-sm text-sand-600">
          Waiting for <span className="font-semibold text-sand-800">{activePlayerName}</span> to resolve actions
        </p>
      )}
      {myUnresolved.length > 0 && (
        <div className="flex flex-wrap gap-1 justify-center mt-2">
          <span className="text-[0.65rem] text-sand-500">Your remaining:</span>
          {myUnresolved.map(s => (
            <span key={s.actionType} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sand-100 border border-sand-200 text-[0.65rem] text-sand-600 font-medium">
              {ACTION_INFO[s.actionType].icon} {ACTION_INFO[s.actionType].label}
            </span>
          ))}
        </div>
      )}
      {myUnresolved.length === 0 && mySlots.length > 0 && (
        <p className="text-xs text-emerald-600 font-medium">All your actions resolved ✓</p>
      )}
    </motion.div>
  );
};
