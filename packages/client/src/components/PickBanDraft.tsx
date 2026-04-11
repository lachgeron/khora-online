import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PoliticsCard, CityCard } from '../types';
import { CountdownTimer } from './CountdownTimer';

export interface PickBanDraftProps {
  allCards: PoliticsCard[];
  bannedCards: Record<string, PoliticsCard[]>;
  pickedCards: Record<string, PoliticsCard[]>;
  turnOrder: string[];
  currentTurnIndex: number;
  phase: 'BAN' | 'PICK';
  bansPerPlayer: number;
  picksPerPlayer: number;
  currentPlayerId: string;
  playerNames: Record<string, string>;
  pendingDecisions?: { playerId: string; decisionType: string; timeoutAt: number; usingTimeBank?: boolean }[];
  onPickBanCard: (cardId: string, action: 'BAN' | 'PICK') => void;
  cityCard: CityCard | null;
  otherPlayerCities: { playerId: string; playerName: string; city: CityCard }[];
}

const TYPE_STYLE: Record<string, string> = {
  IMMEDIATE: 'bg-amber-100 text-amber-800',
  ONGOING: 'bg-emerald-100 text-emerald-800',
  END_GAME: 'bg-purple-100 text-purple-800',
};

// Assign colors to players for their picks/bans
const PLAYER_COLORS = [
  { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-700', ring: 'ring-blue-400' },
  { bg: 'bg-rose-100', border: 'border-rose-300', text: 'text-rose-700', ring: 'ring-rose-400' },
  { bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-700', ring: 'ring-emerald-400' },
  { bg: 'bg-amber-100', border: 'border-amber-300', text: 'text-amber-700', ring: 'ring-amber-400' },
];

export const PickBanDraft: React.FC<PickBanDraftProps> = ({
  allCards, bannedCards, pickedCards, turnOrder, currentTurnIndex,
  phase, bansPerPlayer, picksPerPlayer, currentPlayerId, playerNames,
  pendingDecisions, onPickBanCard, cityCard, otherPlayerCities,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedCities, setExpandedCities] = useState<Record<string, boolean>>({});

  const currentTurnPlayerId = turnOrder[currentTurnIndex];
  const isMyTurn = currentTurnPlayerId === currentPlayerId;

  // Build lookup for which cards are banned/picked and by whom
  const bannedCardIds = new Map<string, string>(); // cardId → playerId
  for (const [pid, cards] of Object.entries(bannedCards)) {
    for (const c of cards) bannedCardIds.set(c.id, pid);
  }
  const pickedCardIds = new Map<string, string>(); // cardId → playerId
  for (const [pid, cards] of Object.entries(pickedCards)) {
    for (const c of cards) pickedCardIds.set(c.id, pid);
  }

  const availableCards = allCards.filter(c => !bannedCardIds.has(c.id) && !pickedCardIds.has(c.id));

  // Player color assignments based on turn order
  const playerColorMap: Record<string, typeof PLAYER_COLORS[0]> = {};
  turnOrder.forEach((pid, i) => {
    playerColorMap[pid] = PLAYER_COLORS[i % PLAYER_COLORS.length];
  });

  const toggleCity = (playerId: string) => {
    setExpandedCities(prev => ({ ...prev, [playerId]: !prev[playerId] }));
  };

  // Calculate progress
  const totalBans = turnOrder.length * bansPerPlayer;
  const currentBans = Object.values(bannedCards).reduce((sum, cards) => sum + cards.length, 0);
  const totalPicks = turnOrder.length * picksPerPlayer;
  const currentPicks = Object.values(pickedCards).reduce((sum, cards) => sum + cards.length, 0);

  // My picked cards
  const myPickedCards = pickedCards[currentPlayerId] ?? [];

  return (
    <div className="col-span-full max-w-6xl mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="font-display text-2xl font-bold text-sand-800">Pick / Ban Draft</h2>
        <div className="mt-2 flex items-center justify-center gap-2">
          <span className={`px-3 py-1 rounded-full text-sm font-bold ${
            phase === 'BAN'
              ? 'bg-crimson/10 text-crimson'
              : 'bg-gold/20 text-sand-800'
          }`}>
            {phase === 'BAN' ? `Ban Phase (${currentBans}/${totalBans})` : `Pick Phase (${currentPicks}/${totalPicks})`}
          </span>
        </div>
        {/* Timer */}
        {isMyTurn && (() => {
          const myDecision = pendingDecisions?.find(d => d.playerId === currentPlayerId);
          return myDecision ? (
            <div className="max-w-xs mx-auto mt-3">
              <CountdownTimer timeoutAt={myDecision.timeoutAt} usingTimeBank={myDecision.usingTimeBank} />
            </div>
          ) : null;
        })()}
      </div>

      {/* Turn Order */}
      <div className="rounded-xl bg-sand-50 border border-sand-200 p-4">
        <p className="font-display text-[0.65rem] uppercase tracking-[0.12em] text-sand-500 mb-3">Turn order</p>
        <div className="flex items-center justify-center gap-1 flex-wrap">
          {turnOrder.map((pid, i) => {
            const isMe = pid === currentPlayerId;
            const isCurrent = i === currentTurnIndex;
            const colors = playerColorMap[pid];
            return (
              <React.Fragment key={pid}>
                <div
                  className={`px-3 py-1.5 rounded-lg text-sm font-display font-semibold transition-colors ${
                    isCurrent
                      ? `${colors.bg} ${colors.text} ring-2 ${colors.ring}`
                      : isMe
                        ? 'bg-sand-800 text-sand-100'
                        : 'bg-white text-sand-600 border border-sand-200'
                  }`}
                >
                  {isMe ? 'You' : (playerNames[pid] ?? pid)}
                  {isCurrent && <span className="ml-1 text-xs opacity-60">{phase === 'BAN' ? '(banning)' : '(picking)'}</span>}
                </div>
                {i < turnOrder.length - 1 && (
                  <span className="text-sand-300 text-lg mx-1">→</span>
                )}
              </React.Fragment>
            );
          })}
        </div>
        <p className="text-center text-xs text-sand-500 mt-2">
          {isMyTurn
            ? <span className="font-semibold text-sand-800">Your turn to {phase === 'BAN' ? 'ban' : 'pick'} a card!</span>
            : `Waiting for ${playerNames[currentTurnPlayerId] ?? currentTurnPlayerId} to ${phase === 'BAN' ? 'ban' : 'pick'}...`
          }
        </p>
      </div>

      {/* Player picks/bans summary */}
      <div className="grid grid-cols-2 gap-3">
        {turnOrder.map(pid => {
          const colors = playerColorMap[pid];
          const isMe = pid === currentPlayerId;
          const playerBans = bannedCards[pid] ?? [];
          const playerPicks = pickedCards[pid] ?? [];
          return (
            <div key={pid} className={`rounded-lg border p-3 ${colors.border} ${colors.bg}`}>
              <p className={`font-display text-xs font-bold ${colors.text} mb-1`}>
                {isMe ? 'You' : (playerNames[pid] ?? pid)}
              </p>
              <div className="text-[0.65rem] text-sand-600 space-y-0.5">
                <p>Bans: {playerBans.map(c => c.name).join(', ') || 'None'}</p>
                <p>Picks: {playerPicks.map(c => c.name).join(', ') || 'None'} ({playerPicks.length}/{picksPerPlayer})</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* City Reference */}
      {cityCard && (
        <div className="rounded-xl bg-sand-50 border border-sand-200 p-4 space-y-3">
          <p className="font-display text-[0.65rem] uppercase tracking-[0.12em] text-sand-500">City abilities</p>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-display text-sm font-bold text-sand-800">{cityCard.name}</span>
            <span className="px-1.5 py-0.5 rounded bg-sand-800 text-sand-100 text-[0.55rem] font-bold uppercase">You</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {cityCard.developments.map((dev) => {
              const devTypeStyle: Record<string, string> = {
                IMMEDIATE: 'bg-amber-100 text-amber-800',
                ONGOING: 'bg-emerald-100 text-emerald-800',
                END_GAME: 'bg-purple-100 text-purple-800',
              };
              return (
                <div key={dev.id} className="rounded-lg bg-white border border-sand-200 p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-display text-xs font-bold text-sand-700">Lv {dev.level}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase ${devTypeStyle[dev.effectType] ?? ''}`}>
                      {dev.effectType.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-[0.65rem] text-sand-600 leading-snug mb-1">{dev.name}</p>
                </div>
              );
            })}
          </div>
          {otherPlayerCities.length > 0 && (
            <div className="border-t border-sand-200 pt-3 space-y-2">
              {otherPlayerCities.map(({ playerId, playerName, city }) => {
                const isExpanded = expandedCities[playerId] ?? false;
                return (
                  <div key={playerId}>
                    <button
                      onClick={() => toggleCity(playerId)}
                      className="flex items-center gap-2 w-full text-left group"
                    >
                      <span className="text-xs text-sand-400 group-hover:text-sand-600 transition-colors">
                        {isExpanded ? '▾' : '▸'}
                      </span>
                      <span className="font-display text-sm font-semibold text-sand-700 group-hover:text-sand-900 transition-colors">
                        {playerName}
                      </span>
                      <span className="text-xs text-sand-400">— {city.name}</span>
                    </button>
                    {isExpanded && (
                      <div className="mt-2 ml-4 grid grid-cols-2 gap-2">
                        {city.developments.map((dev) => (
                          <div key={dev.id} className="rounded-lg bg-white border border-sand-200 p-3">
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <span className="font-display text-xs font-bold text-sand-700">Lv {dev.level}</span>
                            </div>
                            <p className="text-[0.65rem] text-sand-600 leading-snug">{dev.name}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* My drafted cards */}
      {myPickedCards.length > 0 && (
        <div>
          <p className="font-display text-[0.65rem] uppercase tracking-[0.12em] text-sand-500 mb-2">Your picked cards ({myPickedCards.length}/{picksPerPlayer})</p>
          <div className="grid grid-cols-2 gap-2">
            {myPickedCards.map(card => {
              const typeColor = TYPE_STYLE[card.type] ?? '';
              return (
                <div key={card.id} className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-display text-xs font-bold text-sand-800">{card.name}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase ${typeColor}`}>
                      {card.type.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-[0.65rem] text-sand-500 leading-snug mb-1.5">{card.description}</p>
                  <div className="flex items-center gap-2 text-[0.6rem] text-sand-400">
                    {card.cost > 0 && <span>{card.cost} coins</span>}
                    {card.knowledgeRequirement.red > 0 && <span>{card.knowledgeRequirement.red} red</span>}
                    {card.knowledgeRequirement.blue > 0 && <span>{card.knowledgeRequirement.blue} blue</span>}
                    {card.knowledgeRequirement.green > 0 && <span>{card.knowledgeRequirement.green} green</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Not your turn */}
      {!isMyTurn && (
        <div className="text-center py-4">
          <p className="text-sand-600">Waiting for {playerNames[currentTurnPlayerId] ?? currentTurnPlayerId} to {phase === 'BAN' ? 'ban' : 'pick'} a card...</p>
        </div>
      )}

      {/* Card Pool */}
      <div>
        <p className="text-sm text-sand-600 mb-3">
          {isMyTurn
            ? `Select a card to ${phase === 'BAN' ? 'ban' : 'pick'} (${availableCards.length} available):`
            : `All cards (${availableCards.length} available):`
          }
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence>
            {allCards.map((card) => {
              const isBanned = bannedCardIds.has(card.id);
              const isPicked = pickedCardIds.has(card.id);
              const bannedByPid = bannedCardIds.get(card.id);
              const pickedByPid = pickedCardIds.get(card.id);
              const isAvailable = !isBanned && !isPicked;
              const isSelected = selectedId === card.id;
              const ownerColors = bannedByPid ? playerColorMap[bannedByPid] : pickedByPid ? playerColorMap[pickedByPid] : null;

              return (
                <motion.div
                  key={card.id}
                  layout
                  className={`rounded-xl border-2 p-4 transition-all ${
                    isBanned
                      ? `${ownerColors?.bg ?? 'bg-red-50'} ${ownerColors?.border ?? 'border-red-300'} opacity-50`
                      : isPicked
                        ? `${ownerColors?.bg ?? 'bg-blue-50'} ${ownerColors?.border ?? 'border-blue-300'} opacity-60`
                        : isSelected && isMyTurn
                          ? 'border-gold bg-gold/5 shadow-lg scale-[1.02] cursor-pointer'
                          : isMyTurn
                            ? 'border-sand-200 bg-sand-50 hover:border-sand-400 hover:shadow-sm cursor-pointer'
                            : 'border-sand-200 bg-sand-50'
                  }`}
                  onClick={() => {
                    if (isAvailable && isMyTurn) setSelectedId(card.id);
                  }}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className={`font-display text-sm font-bold ${isBanned ? 'line-through text-sand-400' : 'text-sand-800'}`}>
                      {card.name}
                    </span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase ${TYPE_STYLE[card.type] ?? ''}`}>
                      {card.type.replace('_', ' ')}
                    </span>
                  </div>

                  <p className={`text-xs leading-snug mb-2 ${isBanned || isPicked ? 'text-sand-400' : 'text-sand-500'}`}>
                    {card.description}
                  </p>

                  <div className="flex items-center gap-2 text-[0.7rem] text-sand-400">
                    {card.cost > 0 && <span>{card.cost} coins</span>}
                    {card.knowledgeRequirement.red > 0 && <span>{card.knowledgeRequirement.red} red</span>}
                    {card.knowledgeRequirement.blue > 0 && <span>{card.knowledgeRequirement.blue} blue</span>}
                    {card.knowledgeRequirement.green > 0 && <span>{card.knowledgeRequirement.green} green</span>}
                    {card.cost === 0 && !card.knowledgeRequirement.red && !card.knowledgeRequirement.blue && !card.knowledgeRequirement.green && <span>Free</span>}
                  </div>

                  {/* Status badges */}
                  {isBanned && (
                    <div className={`mt-2 text-xs font-semibold ${ownerColors?.text ?? 'text-red-600'}`}>
                      Banned by {bannedByPid === currentPlayerId ? 'You' : (playerNames[bannedByPid!] ?? bannedByPid)}
                    </div>
                  )}
                  {isPicked && (
                    <div className={`mt-2 text-xs font-semibold ${ownerColors?.text ?? 'text-blue-600'}`}>
                      Picked by {pickedByPid === currentPlayerId ? 'You' : (playerNames[pickedByPid!] ?? pickedByPid)}
                    </div>
                  )}

                  {/* Confirm button */}
                  {isSelected && isMyTurn && isAvailable && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPickBanCard(card.id, phase);
                        setSelectedId(null);
                      }}
                      className={`mt-3 w-full py-2.5 rounded-lg font-semibold text-sm transition-colors ${
                        phase === 'BAN'
                          ? 'bg-crimson text-white hover:bg-crimson/90'
                          : 'bg-gold text-sand-900 hover:bg-gold-dim'
                      }`}
                    >
                      {phase === 'BAN' ? `Ban ${card.name}` : `Pick ${card.name}`}
                    </motion.button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
