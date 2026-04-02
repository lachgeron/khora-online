import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PoliticsCard, CityCard } from '../types';

export interface PoliticsDraftProps {
  draftPack: PoliticsCard[] | null;
  draftedCards: PoliticsCard[] | null;
  draftRound: number;
  totalRounds: number;
  waitingFor: string[];
  currentPlayerId: string;
  playerNames: Record<string, string>;
  onDraftCard: (cardId: string) => void;
  cityCard: CityCard | null;
}

const TYPE_STYLE: Record<string, string> = {
  IMMEDIATE: 'bg-amber-100 text-amber-800',
  ONGOING: 'bg-emerald-100 text-emerald-800',
  END_GAME: 'bg-purple-100 text-purple-800',
};

export const PoliticsDraft: React.FC<PoliticsDraftProps> = ({
  draftPack, draftedCards, draftRound, totalRounds,
  waitingFor, currentPlayerId, playerNames, onDraftCard, cityCard,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCity, setShowCity] = useState(false);
  const hasAlreadyPicked = !waitingFor.includes(currentPlayerId);
  const waitingNames = waitingFor.filter(id => id !== currentPlayerId).map(id => playerNames[id] ?? id);

  return (
    <div className="col-span-full max-w-4xl mx-auto py-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h2 className="font-display text-2xl font-bold text-sand-800">Card Draft</h2>
        <div className="flex items-center justify-center gap-3 mt-2">
          {Array.from({ length: totalRounds }, (_, i) => (
            <div
              key={i}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                i + 1 < draftRound ? 'bg-gold text-sand-900'
                : i + 1 === draftRound ? 'bg-sand-800 text-sand-100 ring-2 ring-gold'
                : 'bg-sand-200 text-sand-400'
              }`}
            >
              {i + 1}
            </div>
          ))}
        </div>
      </div>

      {/* City info toggle */}
      {cityCard && (
        <div className="mb-6">
          <button
            onClick={() => setShowCity(!showCity)}
            className="flex items-center gap-2 text-sm text-sand-500 hover:text-sand-700 transition-colors"
          >
            <span className="text-xs">{showCity ? '▾' : '▸'}</span>
            <span className="font-display font-semibold">{cityCard.name}</span>
            <span className="text-xs text-sand-400">— your city &amp; developments</span>
          </button>
          {showCity && (
            <div className="mt-2 rounded-lg bg-sand-50 border border-sand-200 p-4">
              <div className="grid grid-cols-2 gap-2">
                {cityCard.developments.map((dev) => {
                  const DEV_TYPE_STYLE: Record<string, string> = {
                    IMMEDIATE: 'bg-amber-100 text-amber-800',
                    ONGOING: 'bg-emerald-100 text-emerald-800',
                    END_GAME: 'bg-purple-100 text-purple-800',
                  };
                  return (
                    <div key={dev.id} className="rounded-lg bg-white border border-sand-200 p-3">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="font-display text-xs font-bold text-sand-700">Lv {dev.level}</span>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase ${DEV_TYPE_STYLE[dev.effectType] ?? ''}`}>
                          {dev.effectType.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="text-[0.65rem] text-sand-600 leading-snug mb-1">{dev.name}</p>
                      <div className="flex items-center gap-2 text-[0.6rem] text-sand-400">
                        {dev.drachmaCost > 0 && <span>{dev.drachmaCost} 💰</span>}
                        {dev.knowledgeRequirement.red > 0 && <span>{dev.knowledgeRequirement.red} 🔴</span>}
                        {dev.knowledgeRequirement.blue > 0 && <span>{dev.knowledgeRequirement.blue} 🔵</span>}
                        {dev.knowledgeRequirement.green > 0 && <span>{dev.knowledgeRequirement.green} 🟢</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Already drafted cards — full details */}
      {draftedCards && draftedCards.length > 0 && (
        <div className="mb-6">
          <p className="font-display text-[0.65rem] uppercase tracking-[0.12em] text-sand-500 mb-2">Your drafted cards ({draftedCards.length})</p>
          <div className="grid grid-cols-2 gap-2">
            {draftedCards.map(card => {
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
                    {card.cost > 0 && <span>{card.cost} 💰</span>}
                    {card.knowledgeRequirement.red > 0 && <span>{card.knowledgeRequirement.red} 🔴</span>}
                    {card.knowledgeRequirement.blue > 0 && <span>{card.knowledgeRequirement.blue} 🔵</span>}
                    {card.knowledgeRequirement.green > 0 && <span>{card.knowledgeRequirement.green} 🟢</span>}
                    {card.cost === 0 && !card.knowledgeRequirement.red && !card.knowledgeRequirement.blue && !card.knowledgeRequirement.green && <span>Free</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Waiting state */}
      {hasAlreadyPicked && (
        <div className="text-center py-8">
          <p className="text-sand-600">You've picked your card this round.</p>
          {waitingNames.length > 0 && (
            <p className="text-sm text-sand-400 mt-1">Waiting for {waitingNames.join(', ')}...</p>
          )}
        </div>
      )}

      {/* Pack to pick from */}
      {!hasAlreadyPicked && draftPack && draftPack.length > 0 && (
        <div>
          <p className="text-sm text-sand-600 mb-3">Pick one card ({draftPack.length} available):</p>
          <div className="grid grid-cols-2 gap-3">
            <AnimatePresence>
              {draftPack.map((card, i) => {
                const isSelected = selectedId === card.id;
                return (
                  <motion.div
                    key={card.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    onClick={() => setSelectedId(card.id)}
                    className={`cursor-pointer rounded-xl border-2 p-4 transition-all ${
                      isSelected
                        ? 'border-gold bg-gold/5 shadow-lg scale-[1.02]'
                        : 'border-sand-200 bg-sand-50 hover:border-sand-400 hover:shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-display text-sm font-bold text-sand-800">{card.name}</span>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase ${TYPE_STYLE[card.type] ?? ''}`}>
                        {card.type.replace('_', ' ')}
                      </span>
                    </div>

                    <p className="text-xs text-sand-500 leading-snug mb-2">{card.description}</p>

                    <div className="flex items-center gap-2 text-[0.7rem] text-sand-400">
                      {card.cost > 0 && <span>{card.cost} 💰</span>}
                      {card.knowledgeRequirement.red > 0 && <span>{card.knowledgeRequirement.red} 🔴</span>}
                      {card.knowledgeRequirement.blue > 0 && <span>{card.knowledgeRequirement.blue} 🔵</span>}
                      {card.knowledgeRequirement.green > 0 && <span>{card.knowledgeRequirement.green} 🟢</span>}
                      {card.cost === 0 && !card.knowledgeRequirement.red && !card.knowledgeRequirement.blue && !card.knowledgeRequirement.green && <span>Free</span>}
                    </div>

                    {isSelected && (
                      <motion.button
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        onClick={(e) => { e.stopPropagation(); onDraftCard(card.id); }}
                        className="mt-3 w-full py-2.5 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim transition-colors"
                      >
                        Draft {card.name}
                      </motion.button>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      {!hasAlreadyPicked && (!draftPack || draftPack.length === 0) && (
        <p className="text-center text-sand-400 py-8">No cards available.</p>
      )}
    </div>
  );
};
