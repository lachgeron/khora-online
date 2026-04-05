import React, { useState } from 'react';
import type { PublicGameState, PrivatePlayerState } from '../types';
import { PlayerBoard } from './PlayerBoard';
import { SharedTracks } from './SharedTracks';
import { VPTrack } from './VPTrack';
import { KnowledgeStore } from './KnowledgeStore';
import { AchievementsDisplay } from './AchievementsDisplay';
import { GameLog } from './GameLog';
import { CardDisplay } from './CardDisplay';
import { ActionOverview } from './ActionOverview';
import { motion, AnimatePresence } from 'framer-motion';

export interface GameBoardProps {
  gameState: PublicGameState;
  privateState: PrivatePlayerState;
  currentPlayerId: string;
  statusText?: string;
  isMyTurn?: boolean;
  children?: React.ReactNode;
  onActivateDev?: (devId: string) => void;
}

export const GameBoard: React.FC<GameBoardProps> = ({ gameState, privateState, currentPlayerId, statusText, isMyTurn, children, onActivateDev }) => {
  const [selectedPlayerId, setSelectedPlayerId] = useState(currentPlayerId);
  const [openPanel, setOpenPanel] = useState<'vp' | 'tracks' | 'knowledge' | null>(null);
  const me = gameState.players.find(p => p.playerId === currentPlayerId);
  const selectedPlayer = gameState.players.find(p => p.playerId === selectedPlayerId);
  const isViewingSelf = selectedPlayerId === currentPlayerId;

  const togglePanel = (panel: 'vp' | 'tracks' | 'knowledge') =>
    setOpenPanel(prev => prev === panel ? null : panel);

  const TURN_PHASES: { phase: string; label: string }[] = [
    { phase: 'OMEN', label: 'Event Announcement' },
    { phase: 'TAXATION', label: 'Tax' },
    { phase: 'DICE', label: 'Dice' },
    { phase: 'ACTIONS', label: 'Action' },
    { phase: 'PROGRESS', label: 'Progress' },
    { phase: 'GLORY', label: 'Event Resolution' },
    { phase: 'ACHIEVEMENT', label: 'Achievement' },
  ];

  const currentPhaseIndex = TURN_PHASES.findIndex(p => p.phase === gameState.currentPhase);

  return (
    <>
      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="col-span-full px-5 py-3 bg-gradient-to-r from-sand-800 to-sand-700 rounded-xl"
      >
        <div className="flex items-center gap-3 mb-2">
          <h1 className="font-display text-gold text-sm tracking-[0.1em] uppercase font-semibold">Khora</h1>
          <span className="px-3 py-1 bg-white/10 text-sand-100 rounded-full text-xs font-medium">
            Round {gameState.roundNumber} / 9
          </span>
          {statusText && (
            <span className={`ml-auto px-3 py-1 rounded-full text-xs font-semibold ${
              isMyTurn
                ? 'bg-amber-400/90 text-sand-900 animate-pulse'
                : 'bg-white/10 text-sand-300'
            }`}>
              {statusText}
            </span>
          )}
        </div>
        {/* Phase tracker */}
        <div className="flex items-center gap-0.5">
          {TURN_PHASES.map((p, i) => {
            const isCurrent = p.phase === gameState.currentPhase;
            const isPast = currentPhaseIndex >= 0 && i < currentPhaseIndex;
            return (
              <React.Fragment key={p.phase}>
                {i > 0 && (
                  <div className={`flex-shrink-0 w-3 h-px ${isPast || isCurrent ? 'bg-gold/60' : 'bg-white/15'}`} />
                )}
                <div
                  className={`flex-1 text-center py-1 px-1 rounded-md text-[0.6rem] font-semibold tracking-wide transition-colors ${
                    isCurrent
                      ? 'bg-gold text-sand-900'
                      : isPast
                      ? 'bg-white/10 text-sand-300'
                      : 'bg-white/5 text-sand-500'
                  }`}
                >
                  {p.label}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </motion.div>

      {/* ── Left: Player board ── */}
      <div className="row-span-2 overflow-y-auto rounded-xl bg-sand-100 border border-sand-300 p-3">
        {/* Player tabs */}
        <div className="flex gap-1 mb-3 flex-wrap">
          {gameState.players.map(player => {
            const isActive = player.playerId === selectedPlayerId;
            const isSelf = player.playerId === currentPlayerId;
            return (
              <button
                key={player.playerId}
                onClick={() => setSelectedPlayerId(player.playerId)}
                className={`px-2.5 py-1 rounded-md text-[0.65rem] font-semibold transition-colors ${
                  isActive
                    ? 'bg-sand-700 text-sand-100'
                    : 'bg-sand-200 text-sand-500 hover:bg-sand-300'
                }`}
              >
                {isSelf ? 'You' : player.playerName}
              </button>
            );
          })}
        </div>
        {selectedPlayer && (
          <PlayerBoard
            publicState={selectedPlayer}
            privateState={isViewingSelf ? privateState : null}
            cityCard={gameState.cityCards?.[selectedPlayer.cityId]}
            onActivateDev={isViewingSelf ? onActivateDev : undefined}
          />
        )}
      </div>

      {/* ── Center: Action Panel + VP, Shared Tracks, Knowledge Store ── */}
      <div className="space-y-3 overflow-y-auto">
        {/* Action panel — injected from App */}
        {children && (
          <div className="rounded-xl bg-sand-50 border-2 border-gold p-4">
            {children}
          </div>
        )}
        {/* Cards: hand + played */}
        <div className="rounded-xl bg-sand-100 border border-sand-300 p-3">
          <CardDisplay handCards={privateState.handCards} playedCards={privateState.playedCards} />
        </div>
      </div>

      {/* ── Right sidebar: Event, Players, Achievements ── */}
      <div className="row-span-2 flex flex-col gap-3 overflow-y-auto">
        {/* Event — hidden during OMEN so the announcement's layoutId animates here on phase change */}
        {gameState.currentEvent && gameState.currentPhase !== 'OMEN' && gameState.currentPhase !== 'GLORY' && (
          <motion.div
            layoutId="event-card"
            className="bg-gradient-to-br from-sand-200 to-sand-100 border-2 border-gold rounded-lg px-4 py-3"
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            <p className="font-display text-sm font-semibold text-sand-800">{gameState.currentEvent.name}</p>
            <p className="text-xs text-sand-600 mt-0.5">{gameState.currentEvent.gloryCondition.description}</p>
          </motion.div>
        )}

        {/* Action Overview — visible during ACTIONS phase */}
        {gameState.currentPhase === 'ACTIONS' && (
          <div className="rounded-xl bg-sand-100 border border-sand-300 p-3">
            <ActionOverview gameState={gameState} currentPlayerId={currentPlayerId} />
          </div>
        )}

        {/* Info panels */}
        <div className="rounded-xl bg-sand-100 border border-sand-300 p-2">
          <div className="flex gap-1.5">
            {([
              { key: 'vp' as const, label: 'VP', icon: '★' },
              { key: 'tracks' as const, label: 'Tracks', icon: '📊' },
              { key: 'knowledge' as const, label: 'Knowledge', icon: '🔮' },
            ]).map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => togglePanel(key)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-lg text-center transition-all ${
                  openPanel === key
                    ? 'bg-sand-700 text-sand-100 shadow-md'
                    : 'bg-sand-200 text-sand-600 hover:bg-sand-300'
                }`}
              >
                <span className="text-base leading-none">{icon}</span>
                <span className="text-[0.6rem] font-semibold">{label}</span>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            {openPanel && (
              <motion.div
                key={openPanel}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="pt-2">
                  {openPanel === 'vp' && (
                    <VPTrack players={gameState.players} currentPlayerId={currentPlayerId} />
                  )}
                  {openPanel === 'tracks' && (
                    <SharedTracks players={gameState.players} currentPlayerId={currentPlayerId} />
                  )}
                  {openPanel === 'knowledge' && gameState.centralBoardTokens.length > 0 && (
                    <KnowledgeStore tokens={gameState.centralBoardTokens} compact />
                  )}
                  {openPanel === 'knowledge' && gameState.centralBoardTokens.length === 0 && (
                    <p className="text-xs text-sand-400 text-center py-2">No tokens available.</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Achievements */}
        <div className="rounded-xl bg-sand-100 border border-sand-300 p-3">
          <AchievementsDisplay
            available={gameState.availableAchievements}
            claimed={gameState.claimedAchievements}
            players={gameState.players}
          />
        </div>

        {/* Game Log */}
        <div className="rounded-xl bg-sand-100 border border-sand-300 p-3">
          <GameLog
            entries={gameState.gameLog}
            playerNames={Object.fromEntries(gameState.players.map(p => [p.playerId, p.playerName]))}
            playerOrder={gameState.players.map(p => p.playerId)}
          />
        </div>
      </div>
    </>
  );
};
