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

/** Compute highest/lowest troop players from public state. */
function getTroopRankings(players: PublicGameState['players']) {
  const connected = players.filter(p => p.isConnected);
  if (connected.length === 0) return { highest: [] as string[], lowest: [] as string[], maxTroops: 0, minTroops: 0 };
  const max = Math.max(...connected.map(p => p.troopTrack));
  const min = Math.min(...connected.map(p => p.troopTrack));
  return {
    highest: connected.filter(p => p.troopTrack === max).map(p => p.playerId),
    lowest: connected.filter(p => p.troopTrack === min).map(p => p.playerId),
    maxTroops: max,
    minTroops: min,
  };
}

/** Build per-player effect summaries based on event type and game log. */
function buildPlayerSummaries(
  eventId: string,
  players: PublicGameState['players'],
  gameLog: PublicGameState['gameLog'],
  roundNumber: number,
  pendingDecisions: PublicGameState['pendingDecisions'],
): Record<string, { effects: string[]; role: 'highest' | 'lowest' | 'all' | null }> {
  const result: Record<string, { effects: string[]; role: 'highest' | 'lowest' | 'all' | null }> = {};
  const { highest, lowest } = getTroopRankings(players);

  // Initialize all players
  for (const p of players) {
    result[p.playerId] = { effects: [], role: null };
  }

  // Extract changes from game log (logPlayerDiff entries have a `changes` array)
  for (const entry of gameLog) {
    if (entry.roundNumber === roundNumber && entry.phase === 'GLORY' && entry.playerId) {
      const changes = entry.details?.changes as string[] | undefined;
      if (changes && changes.length > 0) {
        if (result[entry.playerId]) {
          result[entry.playerId].effects.push(...changes);
        }
      }
    }
  }

  // Also parse plain-text log actions for interactive events
  for (const entry of gameLog) {
    if (entry.roundNumber !== roundNumber || entry.phase !== 'GLORY' || !entry.playerId) continue;
    if (result[entry.playerId]?.effects.length > 0) continue; // Already have changes from logPlayerDiff

    const action = entry.action;
    if (action.includes('Oracle of Delphi:')) {
      const match = action.match(/lost (\w+) token.*gained (\d+) scrolls/);
      if (match) {
        result[entry.playerId].effects.push(`-1 ${match[1]} token`, `+${match[2]} scrolls`);
      }
    } else if (action.includes('Played a politics card via Prosperity')) {
      result[entry.playerId].effects.push('Played a politics card');
    } else if (action.includes('Military Victory:')) {
      const match = action.match(/advanced (\w+) \(paid (\d+)\)/);
      if (match) {
        result[entry.playerId].effects.push(`+1 ${match[1]}`, `paid ${match[2]} drachma`);
      }
    } else if (action.includes('Rise of Persia:')) {
      const match = action.match(/advanced MILITARY \(paid (\d+)\)/);
      if (match) {
        result[entry.playerId].effects.push('+1 Military', `paid ${match[1]} drachma`);
      }
    } else if (action.includes('Thirty Tyrants: discarded')) {
      const match = action.match(/discarded (\d+) cards/);
      if (match) {
        result[entry.playerId].effects.push(`-${match[1]} cards`);
      }
    } else if (action.includes('Conquest: took')) {
      const match = action.match(/took (\w+) action/);
      if (match) {
        result[entry.playerId].effects.push(`Took ${match[1]} action`);
      }
    }
  }

  // Assign troop roles based on event type
  switch (eventId) {
    case 'origin-of-academy':
    case 'conscripting-troops':
    case 'eleusinian-mysteries':
    case 'savior-of-greece':
    case 'thirty-tyrants':
    case 'prosperity':
    case 'military-victory':
      for (const pid of highest) { if (result[pid]) result[pid].role = 'highest'; }
      for (const pid of lowest) { if (result[pid]) result[pid].role = 'lowest'; }
      break;
    case 'plague-of-athens':
    case 'supplies-from-lydia':
    case 'drought':
    case 'invention-of-trireme':
    case 'outbreak-of-war':
    case 'oracle-of-delphi':
    case 'rise-of-persia':
    case 'conquest-of-persians':
      for (const p of players) { if (result[p.playerId]) result[p.playerId].role = 'all'; }
      break;
  }

  // For interactive events, show pending status for players who haven't acted yet
  for (const d of pendingDecisions) {
    if (d.decisionType === 'PHASE_DISPLAY' || !result[d.playerId]) continue;
    if (result[d.playerId].effects.length === 0) {
      switch (d.decisionType) {
        case 'PROSPERITY_POLITICS':
          result[d.playerId].effects.push('Choosing a politics card...');
          break;
        case 'ORACLE_CHOOSE_TOKEN':
          result[d.playerId].effects.push('Choosing a token to lose...');
          break;
        case 'MILITARY_VICTORY_PROGRESS':
          result[d.playerId].effects.push('Choosing a track to advance...');
          break;
        case 'RISE_OF_PERSIA_PROGRESS':
          result[d.playerId].effects.push('May advance Military...');
          break;
        case 'THIRTY_TYRANTS_DISCARD':
          result[d.playerId].effects.push('Choosing cards to discard...');
          break;
        case 'CONQUEST_ACTION':
          result[d.playerId].effects.push('Choosing a non-military action...');
          break;
      }
    }
  }

  return result;
}

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  highest: { label: 'MOST TROOPS', className: 'bg-amber-100 text-amber-700 border-amber-300' },
  lowest: { label: 'FEWEST TROOPS', className: 'bg-red-100 text-red-700 border-red-300' },
};

export const GloryEventPanel: React.FC<GloryEventPanelProps> = ({
  gameState, privateState, currentPlayerId, currentPlayer, onResolveAction, onSkip, sendMessage,
}) => {
  const [discardSelection, setDiscardSelection] = useState<string[]>([]);

  if (!gameState.currentEvent) return null;

  const myDecision = gameState.pendingDecisions.find(d => d.playerId === currentPlayerId);
  const dt = myDecision?.decisionType;
  const hasInteractive = dt && dt !== 'PHASE_DISPLAY';

  const eventId = gameState.currentEvent.id;
  const summaries = buildPlayerSummaries(eventId, gameState.players, gameState.gameLog, gameState.roundNumber, gameState.pendingDecisions);

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
        {gameState.players.map((p, idx) => {
          const summary = summaries[p.playerId];
          const effects = summary?.effects ?? [];
          const role = summary?.role;
          const isMe = p.playerId === currentPlayerId;
          const isPending = effects.length === 1 && effects[0].endsWith('...');
          const badge = role && role !== 'all' ? ROLE_BADGE[role] : null;

          // Categorize effects
          const gains = effects.filter(e => e.startsWith('+'));
          const losses = effects.filter(e => e.startsWith('-'));
          const actions = effects.filter(e => !e.startsWith('+') && !e.startsWith('-'));

          // Determine row styling
          let rowClass = 'bg-sand-100';
          if (isPending) {
            rowClass = 'bg-blue-50 border border-blue-200';
          } else if (gains.length > 0 && losses.length === 0) {
            rowClass = 'bg-emerald-50 border border-emerald-200';
          } else if (losses.length > 0 && gains.length === 0) {
            rowClass = 'bg-red-50 border border-red-200';
          } else if (gains.length > 0 && losses.length > 0) {
            rowClass = 'bg-amber-50 border border-amber-200';
          } else if (actions.length > 0) {
            rowClass = 'bg-sand-50 border border-sand-200';
          }

          return (
            <motion.div
              key={p.playerId}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + idx * 0.1 }}
              className={`rounded-lg px-3 py-2.5 ${rowClass}`}
            >
              <div className="flex items-center gap-2">
                <span className={`text-sm ${isMe ? 'font-semibold text-sand-800' : 'text-sand-600'}`}>
                  {p.playerName}{isMe ? ' (you)' : ''}
                </span>
                {badge && (
                  <span className={`text-[0.55rem] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${badge.className}`}>
                    {badge.label}
                  </span>
                )}
                {/* Show troops count for troop-comparison events */}
                {role && role !== 'all' && (
                  <span className="text-[0.6rem] text-sand-400 ml-auto">{p.troopTrack} troops</span>
                )}
              </div>
              {/* Effect details */}
              {effects.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5">
                  {gains.map((g, i) => (
                    <span key={`g${i}`} className="text-xs font-semibold text-emerald-700">{g}</span>
                  ))}
                  {losses.map((l, i) => (
                    <span key={`l${i}`} className="text-xs font-semibold text-red-600">{l}</span>
                  ))}
                  {actions.map((a, i) => (
                    <span key={`a${i}`} className={`text-xs font-medium ${isPending ? 'text-blue-500 italic' : 'text-sand-600'}`}>{a}</span>
                  ))}
                </div>
              )}
              {effects.length === 0 && (
                <span className="text-xs text-sand-400 mt-0.5 block">—</span>
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
          <p className="font-display text-xs uppercase tracking-[0.12em] text-terracotta mb-2 text-center">Military Victory — Progress a Track (2 drachma discount)</p>
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
          <p className="font-display text-xs uppercase tracking-[0.12em] text-terracotta mb-2 text-center">Rise of Persia — Progress Military (2 drachma discount)</p>
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
        <>
          <p className="text-xs text-sand-400 mt-4 text-center animate-pulse">Continuing shortly...</p>

          {/* Game state recap */}
          <div className="mt-5 pt-4 relative">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent to-sand-300" />
              <p className="font-display text-[0.65rem] uppercase tracking-[0.14em] text-sand-400">Round {gameState.roundNumber} Standings</p>
              <div className="flex-1 h-px bg-gradient-to-l from-transparent to-sand-300" />
            </div>
            <div className="space-y-2.5">
              {[...gameState.players]
                .sort((a, b) => b.victoryPoints - a.victoryPoints)
                .map((p, idx) => {
                  const isMe = p.playerId === currentPlayerId;
                  const city = gameState.cityCards?.[p.cityId];
                  const effects = summaries[p.playerId]?.effects ?? [];
                  const playerGains = effects.filter(e => e.startsWith('+'));
                  const playerLosses = effects.filter(e => e.startsWith('-'));
                  const playerActions = effects.filter(e => !e.startsWith('+') && !e.startsWith('-') && !e.endsWith('...'));

                  const TRACK_MAX = 7;
                  const tracks = [
                    { label: 'Econ', value: p.economyTrack, color: 'bg-amber-400' },
                    { label: 'Culture', value: p.cultureTrack, color: 'bg-purple-400' },
                    { label: 'Military', value: p.militaryTrack, color: 'bg-red-400' },
                  ];

                  return (
                    <motion.div
                      key={p.playerId}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 + idx * 0.15, type: 'spring', stiffness: 200, damping: 24 }}
                      className={`relative rounded-xl overflow-hidden ${
                        isMe
                          ? 'bg-gradient-to-br from-sand-100 to-sand-200 border-2 border-gold/40 shadow-md'
                          : 'bg-gradient-to-br from-sand-50 to-sand-100 border border-sand-200 shadow-sm'
                      }`}
                    >
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
                        {/* Track bars */}
                        <div className="space-y-1.5 mb-2">
                          {tracks.map(t => (
                            <div key={t.label} className="flex items-center gap-2">
                              <span className="text-[0.55rem] font-semibold text-sand-400 w-10 text-right">{t.label}</span>
                              <div className="flex-1 h-1.5 bg-sand-200 rounded-full overflow-hidden">
                                <motion.div
                                  className={`h-full rounded-full ${t.color}`}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${(t.value / TRACK_MAX) * 100}%` }}
                                  transition={{ delay: 0.8 + idx * 0.15, duration: 0.6, ease: 'easeOut' }}
                                />
                              </div>
                              <span className="text-[0.55rem] font-bold text-sand-500 w-3 text-right">{t.value}</span>
                            </div>
                          ))}
                        </div>

                        {/* Resource row */}
                        <div className="flex gap-3 text-[0.6rem]">
                          <span className="text-sand-400"><span className="font-semibold text-sand-600">{p.coins}</span> coins</span>
                          <span className="text-sand-400"><span className="font-semibold text-sand-600">{p.troopTrack}</span> troops</span>
                          <span className="text-sand-400"><span className="font-semibold text-sand-600">{p.taxTrack}</span> tax</span>
                          <span className="text-sand-400"><span className="font-semibold text-sand-600">{p.gloryTrack}</span> glory</span>
                          <span className="text-sand-400">dev <span className="font-semibold text-sand-600">{p.developmentLevel}</span></span>
                        </div>
                      </div>

                      {/* Event effect badges — fly down from above */}
                      {(playerGains.length > 0 || playerLosses.length > 0 || playerActions.length > 0) && (
                        <div className="px-3.5 pb-2.5 flex flex-wrap gap-1.5">
                          {playerGains.map((g, i) => (
                            <motion.span
                              key={`g${i}`}
                              initial={{ y: -60 - idx * 40, opacity: 0, scale: 1.4 }}
                              animate={{ y: 0, opacity: 1, scale: 1 }}
                              transition={{
                                delay: 1.2 + idx * 0.15 + i * 0.08,
                                type: 'spring', stiffness: 260, damping: 18,
                              }}
                              className="px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-300 text-[0.6rem] font-bold text-emerald-700 shadow-sm"
                            >
                              {g}
                            </motion.span>
                          ))}
                          {playerLosses.map((l, i) => (
                            <motion.span
                              key={`l${i}`}
                              initial={{ y: -60 - idx * 40, opacity: 0, scale: 1.4 }}
                              animate={{ y: 0, opacity: 1, scale: 1 }}
                              transition={{
                                delay: 1.2 + idx * 0.15 + (playerGains.length + i) * 0.08,
                                type: 'spring', stiffness: 260, damping: 18,
                              }}
                              className="px-2 py-0.5 rounded-full bg-red-100 border border-red-300 text-[0.6rem] font-bold text-red-700 shadow-sm"
                            >
                              {l}
                            </motion.span>
                          ))}
                          {playerActions.map((a, i) => (
                            <motion.span
                              key={`a${i}`}
                              initial={{ y: -60 - idx * 40, opacity: 0, scale: 1.4 }}
                              animate={{ y: 0, opacity: 1, scale: 1 }}
                              transition={{
                                delay: 1.2 + idx * 0.15 + (playerGains.length + playerLosses.length + i) * 0.08,
                                type: 'spring', stiffness: 260, damping: 18,
                              }}
                              className="px-2 py-0.5 rounded-full bg-sand-200 border border-sand-300 text-[0.6rem] font-semibold text-sand-600 shadow-sm"
                            >
                              {a}
                            </motion.span>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
