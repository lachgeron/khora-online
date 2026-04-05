import React, { useState } from 'react';
import type { PublicGameState, PrivatePlayerState, ClientMessage, ActionType, ActionChoices, ProgressTrackType } from '../types';
import { ActionPhase } from './ActionPhase';
import { CountdownTimer } from './CountdownTimer';
import { motion } from 'framer-motion';

const TOKEN_COLORS: Record<string, string> = { RED: '#c44040', BLUE: '#4060c4', GREEN: '#40a050' };
const TRACK_LABELS: Record<string, string> = { ECONOMY: 'Economy', CULTURE: 'Culture', MILITARY: 'Military' };

interface GloryEventPanelProps {
  gameState: PublicGameState;
  privateState: PrivatePlayerState;
  currentPlayerId: string;
  currentPlayer: PublicGameState['players'][0] | undefined;
  onResolveAction: (actionType: ActionType, choices: ActionChoices) => void;
  onSkip: () => void;
  sendMessage: (msg: ClientMessage) => void;
}

export const GloryEventPanel: React.FC<GloryEventPanelProps> = ({
  gameState, privateState, currentPlayerId, currentPlayer, onResolveAction, onSkip, sendMessage,
}) => {
  const [discardSelection, setDiscardSelection] = useState<string[]>([]);

  if (!gameState.currentEvent) return null;

  const myDecision = gameState.pendingDecisions.find(d => d.playerId === currentPlayerId);
  const dt = myDecision?.decisionType;
  const hasInteractive = dt && dt !== 'PHASE_DISPLAY';

  // Gather per-player effects from game log for this round's GLORY phase
  const playerEffects: Record<string, string[]> = {};
  for (const entry of gameState.gameLog) {
    if (entry.roundNumber === gameState.roundNumber && entry.phase === 'GLORY' && entry.playerId) {
      const changes = entry.details?.changes as string[] | undefined;
      if (changes && changes.length > 0) {
        if (!playerEffects[entry.playerId]) playerEffects[entry.playerId] = [];
        playerEffects[entry.playerId].push(...changes);
      }
    }
  }

  return (
    <div className="py-4">
      {/* Timer for interactive decisions */}
      {myDecision && hasInteractive && (
        <div className="mb-4">
          <CountdownTimer timeoutAt={myDecision.timeoutAt} />
        </div>
      )}
      <p className="font-display text-xs uppercase tracking-[0.12em] text-sand-500 mb-3 text-center">Event Resolution</p>

      {/* Event card — slides back from sidebar via shared layoutId */}
      <div className="flex justify-center mb-4">
        <motion.div
          layoutId="event-card"
          className="inline-block bg-gradient-to-br from-sand-200 to-sand-100 border-2 border-gold rounded-lg px-5 py-4 shadow-lg"
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <p className="font-display text-lg font-bold text-sand-800 text-center">{gameState.currentEvent.name}</p>
          <p className="mt-2 font-display text-base font-semibold text-gold-dim leading-snug text-center"
            style={{ textShadow: '0 0 12px rgba(201,168,76,0.25)' }}
          >
            {gameState.currentEvent.gloryCondition.description}
          </p>
        </motion.div>
      </div>

      {/* Per-player results */}
      <div className="space-y-1.5">
        {gameState.players.map(p => {
          const gotGlory = gameState.gameLog.some(
            e => e.roundNumber === gameState.roundNumber && e.phase === 'GLORY' && e.playerId === p.playerId && e.action.includes('VP from glory'),
          );
          const effects = playerEffects[p.playerId] ?? [];
          const hasEffects = effects.length > 0 || gotGlory;
          const isMe = p.playerId === currentPlayerId;

          // Categorize effects as gains or losses
          const gains = effects.filter(e => e.startsWith('+'));
          const losses = effects.filter(e => e.startsWith('-'));
          const other = effects.filter(e => !e.startsWith('+') && !e.startsWith('-'));

          return (
            <motion.div
              key={p.playerId}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + gameState.players.indexOf(p) * 0.1 }}
              className={`rounded-lg px-3 py-2.5 ${
                hasEffects
                  ? gotGlory
                    ? 'bg-emerald-50 border border-emerald-200'
                    : gains.length > 0
                    ? 'bg-amber-50 border border-amber-200'
                    : losses.length > 0
                    ? 'bg-red-50 border border-red-200'
                    : 'bg-sand-100 border border-sand-200'
                  : 'bg-sand-100'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-sm ${isMe ? 'font-semibold text-sand-800' : 'text-sand-600'}`}>
                  {p.playerName}{isMe ? ' (you)' : ''}
                </span>
                {gotGlory && <span className="text-sm font-semibold text-emerald-700">+2 VP</span>}
                {!gotGlory && !hasEffects && <span className="text-xs text-sand-400">—</span>}
              </div>
              {/* Show detailed effects */}
              {(gains.length > 0 || losses.length > 0 || other.length > 0) && (
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                  {gains.map((g, i) => (
                    <span key={`g${i}`} className="text-xs font-semibold text-emerald-700">{g}</span>
                  ))}
                  {losses.map((l, i) => (
                    <span key={`l${i}`} className="text-xs font-semibold text-red-600">{l}</span>
                  ))}
                  {other.map((o, i) => (
                    <span key={`o${i}`} className="text-xs font-medium text-sand-600">{o}</span>
                  ))}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {dt === 'PROSPERITY_POLITICS' && (
        <div className="mt-4 border-t border-sand-200 pt-4">
          <p className="font-display text-xs uppercase tracking-[0.12em] text-gold mb-2 text-center">Prosperity — Play a Politics Card</p>
          <ActionPhase actionType="POLITICS" handCards={privateState.handCards} playerCoins={privateState.coins}
            playerKnowledgeTokens={privateState.knowledgeTokens} philosophyTokens={privateState.philosophyTokens}
            onResolve={onResolveAction} onSkip={onSkip} />
        </div>
      )}

      {dt === 'ORACLE_CHOOSE_TOKEN' && (
        <div className="mt-4 border-t border-sand-200 pt-4">
          <p className="font-display text-xs uppercase tracking-[0.12em] text-purple-600 mb-2 text-center">Oracle of Delphi — Choose a Token to Lose</p>
          <p className="text-xs text-sand-500 text-center mb-3">You will gain 2 philosophy scrolls in return</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {privateState.knowledgeTokens.map(token => (
              <button key={token.id} onClick={() => sendMessage({ type: 'CHOOSE_TOKEN', tokenId: token.id })}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-sand-200 bg-sand-50 hover:border-sand-500 hover:shadow-md transition-all cursor-pointer">
                <span className="w-5 h-5 rounded-full shadow" style={{ background: TOKEN_COLORS[token.color] ?? '#888' }} />
                <span className="text-xs font-semibold text-sand-700">{token.tokenType === 'MAJOR' ? 'Major' : 'Minor'} {token.color}</span>
              </button>
            ))}
          </div>
          <button onClick={onSkip} className="mt-3 w-full py-2 text-sand-500 text-xs font-medium hover:text-sand-700 transition-colors">Auto-choose</button>
        </div>
      )}

      {dt === 'MILITARY_VICTORY_PROGRESS' && (
        <div className="mt-4 border-t border-sand-200 pt-4">
          <p className="font-display text-xs uppercase tracking-[0.12em] text-terracotta mb-2 text-center">Military Victory — Progress a Track (2💰 discount)</p>
          <div className="flex gap-2 justify-center">
            {(['ECONOMY', 'CULTURE', 'MILITARY'] as const).map(track => (
              <button key={track} onClick={() => sendMessage({ type: 'EVENT_PROGRESS_TRACK', track })}
                className="px-4 py-2.5 rounded-lg border-2 border-sand-200 bg-sand-50 hover:border-gold hover:shadow-md transition-all text-sm font-semibold text-sand-700">
                {TRACK_LABELS[track]}
              </button>
            ))}
          </div>
          <button onClick={onSkip} className="mt-3 w-full py-2 text-sand-500 text-xs font-medium hover:text-sand-700 transition-colors">Skip</button>
        </div>
      )}

      {dt === 'RISE_OF_PERSIA_PROGRESS' && (
        <div className="mt-4 border-t border-sand-200 pt-4">
          <p className="font-display text-xs uppercase tracking-[0.12em] text-terracotta mb-2 text-center">Rise of Persia — Progress Military (2💰 discount)</p>
          <div className="flex justify-center">
            <button onClick={() => sendMessage({ type: 'EVENT_PROGRESS_TRACK', track: 'MILITARY' as ProgressTrackType })}
              className="px-5 py-2.5 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim transition-colors">
              Advance Military
            </button>
          </div>
          <button onClick={onSkip} className="mt-3 w-full py-2 text-sand-500 text-xs font-medium hover:text-sand-700 transition-colors">Skip</button>
        </div>
      )}

      {dt === 'THIRTY_TYRANTS_DISCARD' && (() => {
        const toDiscard = Math.min(2, privateState.handCards.length);
        const autoAll = privateState.handCards.length <= 2;
        const toggleCard = (cardId: string) => {
          setDiscardSelection(prev =>
            prev.includes(cardId) ? prev.filter(id => id !== cardId) : prev.length < toDiscard ? [...prev, cardId] : prev,
          );
        };
        return (
          <div className="mt-4 border-t border-sand-200 pt-4">
            <p className="font-display text-xs uppercase tracking-[0.12em] text-crimson mb-2 text-center">
              Thirty Tyrants — Discard {toDiscard} Card{toDiscard > 1 ? 's' : ''}
            </p>
            <p className="text-xs text-sand-500 text-center mb-3">
              {autoAll ? 'All your cards will be discarded' : `Select ${toDiscard} cards to discard`}
            </p>
            <div className="space-y-2">
              {privateState.handCards.map(card => {
                const isSelected = discardSelection.includes(card.id);
                return (
                  <button key={card.id}
                    onClick={() => {
                      if (autoAll) {
                        sendMessage({ type: 'DISCARD_CARDS', cardIds: privateState.handCards.map(c => c.id) });
                      } else {
                        toggleCard(card.id);
                      }
                    }}
                    className={`w-full text-left rounded-lg border-2 p-3 transition-all cursor-pointer ${
                      isSelected
                        ? 'border-crimson bg-red-50 shadow-sm'
                        : 'border-sand-200 bg-sand-50 hover:border-crimson/50 hover:shadow-md'
                    }`}>
                    <div className="flex items-center gap-2">
                      {!autoAll && (
                        <span className={`shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center text-[0.6rem] font-bold ${
                          isSelected ? 'border-crimson bg-crimson text-white' : 'border-sand-400'
                        }`}>
                          {isSelected ? '✓' : ''}
                        </span>
                      )}
                      <div>
                        <span className="font-display text-sm font-semibold text-sand-800">{card.name}</span>
                        <p className="text-xs text-sand-500 mt-0.5">{card.description}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {!autoAll && discardSelection.length === toDiscard && (
              <button
                onClick={() => { sendMessage({ type: 'DISCARD_CARDS', cardIds: discardSelection }); setDiscardSelection([]); }}
                className="mt-3 w-full py-2.5 bg-crimson text-white rounded-lg font-semibold text-sm hover:bg-red-700 transition-colors"
              >
                Discard {toDiscard} Cards
              </button>
            )}
            {!autoAll && discardSelection.length < toDiscard && (
              <p className="mt-2 text-xs text-sand-400 text-center">Select {toDiscard - discardSelection.length} more card{toDiscard - discardSelection.length > 1 ? 's' : ''}</p>
            )}
            <button onClick={onSkip} className="mt-3 w-full py-2 text-sand-500 text-xs font-medium hover:text-sand-700 transition-colors">Auto-discard</button>
          </div>
        );
      })()}

      {dt === 'CONQUEST_ACTION' && (() => {
        const NON_MILITARY_ACTIONS: { type: ActionType; icon: string; label: string }[] = [
          { type: 'PHILOSOPHY', icon: '📜', label: 'Philosophy' },
          { type: 'LEGISLATION', icon: '📋', label: 'Legislation' },
          { type: 'CULTURE', icon: '🎭', label: 'Culture' },
          { type: 'TRADE', icon: '💰', label: 'Trade' },
          { type: 'POLITICS', icon: '🏛', label: 'Politics' },
          { type: 'DEVELOPMENT', icon: '🔨', label: 'Development' },
        ];
        const [conquestAction, setConquestAction] = React.useState<ActionType | null>(null);
        return (
          <div className="mt-4 border-t border-sand-200 pt-4">
            <p className="font-display text-xs uppercase tracking-[0.12em] text-gold mb-2 text-center">Conquest of the Persians — Take Any Non-Military Action</p>
            {!conquestAction && (
              <div className="grid grid-cols-3 gap-2 mb-3">
                {NON_MILITARY_ACTIONS.map(a => (
                  <button key={a.type} onClick={() => setConquestAction(a.type)}
                    className="py-3 rounded-lg border-2 border-sand-200 bg-sand-50 hover:border-gold hover:shadow-md transition-all text-center">
                    <span className="text-lg">{a.icon}</span>
                    <p className="text-[0.65rem] font-semibold text-sand-700 mt-0.5">{a.label}</p>
                  </button>
                ))}
              </div>
            )}
            {conquestAction && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-sand-600">Resolving: <span className="font-semibold">{conquestAction}</span></p>
                  <button onClick={() => setConquestAction(null)} className="text-xs text-sand-400 hover:text-sand-700 underline">Change</button>
                </div>
                <ActionPhase actionType={conquestAction} handCards={privateState.handCards} playerCoins={privateState.coins}
                  playerEconomyTrack={currentPlayer?.economyTrack ?? 0}
                  playerMilitaryTrack={currentPlayer?.militaryTrack ?? 0}
                  playerTroopTrack={currentPlayer?.troopTrack ?? 0}
                  playerKnowledgeTokens={privateState.knowledgeTokens} philosophyTokens={privateState.philosophyTokens}
                  developmentLevel={currentPlayer?.developmentLevel ?? 0}
                  cityId={currentPlayer?.cityId}
                  cityDevelopments={gameState.cityCards?.[currentPlayer?.cityId ?? '']?.developments}
                  centralBoardTokens={gameState.centralBoardTokens} legislationDraw={privateState.legislationDraw}
                  playedCards={privateState.playedCards}
                  onResolve={onResolveAction} onSkip={onSkip} />
              </>
            )}
            {!conquestAction && (
              <button onClick={onSkip} className="w-full py-2 text-sand-500 text-xs font-medium hover:text-sand-700 transition-colors">Skip</button>
            )}
          </div>
        );
      })()}

      {!hasInteractive && (
        <p className="text-xs text-sand-400 mt-4 text-center animate-pulse">Continuing shortly...</p>
      )}
    </div>
  );
};
