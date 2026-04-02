import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { PublicPlayerState, CityCard } from '../types';

export interface PublicPlayerInfoProps {
  player: PublicPlayerState;
  isCurrentPlayer: boolean;
  cityCard?: CityCard;
}

export const PublicPlayerInfo: React.FC<PublicPlayerInfoProps> = ({ player: p, isCurrentPlayer, cityCard }) => {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (hovered && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({
        top: rect.top,
        left: rect.left - 8, // 8px gap from the element
      });
    }
  }, [hovered]);

  return (
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-default transition-colors ${
        isCurrentPlayer ? 'bg-gold/15 border border-gold/30' : 'bg-sand-200 hover:bg-sand-300/60'
      }`}>
        <span className="font-semibold text-xs text-sand-800 flex-1 truncate">
          {p.playerName}
          {isCurrentPlayer && <span className="text-sand-400 ml-1">(you)</span>}
          {!p.isConnected && <span className="text-crimson ml-1">●</span>}
        </span>
        <span className="text-[0.65rem] text-sand-500 font-medium">{p.victoryPoints}★</span>
        <span className="text-[0.65rem] text-sand-400">E{p.economyTrack} C{p.cultureTrack} M{p.militaryTrack}</span>
      </div>

      {hovered && createPortal(
        <div
          className="fixed z-[9999] w-56 rounded-xl bg-sand-800 text-sand-100 shadow-xl border border-sand-600 p-3 text-xs"
          style={{ top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
        >
          <p className="font-display font-bold text-sm text-gold mb-1">{p.playerName}</p>
          {cityCard && <p className="text-sand-400 text-[0.6rem] mb-2">{cityCard.name}</p>}

          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mb-2">
            <span>⚙ Economy: <span className="text-sand-200 font-semibold">{p.economyTrack}</span></span>
            <span>🎭 Culture: <span className="text-sand-200 font-semibold">{p.cultureTrack}</span></span>
            <span>⚔ Military: <span className="text-sand-200 font-semibold">{p.militaryTrack}</span></span>
            <span>💰 Tax: <span className="text-sand-200 font-semibold">{p.taxTrack}</span></span>
            <span>✦ Glory: <span className="text-sand-200 font-semibold">{p.gloryTrack}</span></span>
            <span>🛡 Troops: <span className="text-sand-200 font-semibold">{p.troopTrack}</span></span>
            <span>👤 Citizens: <span className="text-sand-200 font-semibold">{p.citizenTrack}</span></span>
            <span>★ VP: <span className="text-sand-200 font-semibold">{p.victoryPoints}</span></span>
          </div>

          <div className="flex gap-3 text-sand-400 mb-2">
            <span>🃏 {p.handCardCount} in hand</span>
            <span>🔮 {p.knowledgeTokenCount} tokens</span>
            <span>🔨 Dev {p.developmentLevel}</span>
          </div>

          {p.playedCardSummaries.length > 0 ? (
            <div>
              <p className="text-sand-400 font-semibold mb-1">Played cards:</p>
              <div className="space-y-0.5">
                {p.playedCardSummaries.map((c, i) => {
                  const typeColor = c.type === 'IMMEDIATE' ? 'text-amber-400' : c.type === 'ONGOING' ? 'text-emerald-400' : 'text-purple-400';
                  return (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className={`text-[0.55rem] font-bold uppercase ${typeColor}`}>{c.type.charAt(0)}</span>
                      <span className="text-sand-200">{c.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sand-500 italic">No cards played yet</p>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
};
