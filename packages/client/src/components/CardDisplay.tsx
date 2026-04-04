import React, { useState } from 'react';
import type { PoliticsCard } from '../types';

export interface CardDisplayProps {
  handCards: PoliticsCard[];
  playedCards: PoliticsCard[];
}

const TYPE_STYLE: Record<string, string> = {
  IMMEDIATE: 'bg-amber-100 text-amber-800',
  ONGOING: 'bg-emerald-100 text-emerald-800',
  END_GAME: 'bg-purple-100 text-purple-800',
};

export const CardDisplay: React.FC<CardDisplayProps> = ({ handCards, playedCards }) => {
  const [tab, setTab] = useState<'hand' | 'played'>('hand');

  if (handCards.length === 0 && playedCards.length === 0) return null;

  const cards = tab === 'hand' ? handCards : playedCards;

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 mb-2">
        <button
          onClick={() => setTab('hand')}
          className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
            tab === 'hand'
              ? 'bg-sand-700 text-sand-100'
              : 'bg-sand-200 text-sand-500 hover:bg-sand-300'
          }`}
        >
          Hand ({handCards.length})
        </button>
        <button
          onClick={() => setTab('played')}
          className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
            tab === 'played'
              ? 'bg-sand-700 text-sand-100'
              : 'bg-sand-200 text-sand-500 hover:bg-sand-300'
          }`}
        >
          In Play ({playedCards.length})
        </button>
      </div>

      {/* Cards */}
      {cards.length === 0 ? (
        <p className="text-[0.7rem] text-sand-400 py-2">
          {tab === 'hand' ? 'No cards in hand.' : 'No cards in play.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {cards.map(c => {
            const typeColor = TYPE_STYLE[c.type] ?? '';
            return (
              <div
                key={c.id}
                className={`rounded-lg border p-2.5 hover:-translate-y-0.5 hover:shadow-md transition-all ${
                  tab === 'played'
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-sand-50 border-sand-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-display text-xs font-semibold text-sand-800">{c.name}</span>
                  <span className={`shrink-0 px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase ${typeColor}`}>
                    {c.type.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-[0.65rem] text-sand-600 mt-1 leading-snug">{c.description}</p>
                <div className="flex items-center gap-2 text-[0.6rem] text-sand-400 mt-1">
                  {c.cost > 0 && <span>{c.cost} 💰</span>}
                  {c.knowledgeRequirement.red > 0 && <span>{c.knowledgeRequirement.red} 🔴</span>}
                  {c.knowledgeRequirement.blue > 0 && <span>{c.knowledgeRequirement.blue} 🔵</span>}
                  {c.knowledgeRequirement.green > 0 && <span>{c.knowledgeRequirement.green} 🟢</span>}
                  {c.cost === 0 && !c.knowledgeRequirement.red && !c.knowledgeRequirement.blue && !c.knowledgeRequirement.green && <span>Free</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
