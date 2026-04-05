import React, { useState, useRef, useCallback } from 'react';
import type { PoliticsCard } from '../types';

interface AdminSwapModalProps {
  handCards: PoliticsCard[];
  deckCards: PoliticsCard[];
  onSwap: (handCardId: string, deckCardId: string) => void;
  onClose: () => void;
}

const TYPE_STYLE: Record<string, string> = {
  IMMEDIATE: 'bg-amber-100 text-amber-800',
  ONGOING: 'bg-emerald-100 text-emerald-800',
  END_GAME: 'bg-purple-100 text-purple-800',
};

const MiniCard: React.FC<{
  card: PoliticsCard;
  selected: boolean;
  onClick: () => void;
}> = ({ card, selected, onClick }) => {
  const typeColor = TYPE_STYLE[card.type] ?? '';
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-lg border p-2 transition-all ${
        selected
          ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-300'
          : 'border-sand-300 bg-sand-50 hover:border-sand-400'
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="font-display text-[0.65rem] font-semibold text-sand-800 leading-tight">
          {card.name}
        </span>
        <span className={`shrink-0 px-1 py-0.5 rounded text-[0.5rem] font-bold uppercase ${typeColor}`}>
          {card.type.replace('_', ' ')}
        </span>
      </div>
      <p className="text-[0.55rem] text-sand-600 mt-0.5 leading-snug line-clamp-2">{card.description}</p>
      <div className="flex items-center gap-1.5 text-[0.5rem] text-sand-400 mt-0.5">
        {card.cost > 0 && <span>{card.cost} cost</span>}
        {card.knowledgeRequirement.red > 0 && <span>{card.knowledgeRequirement.red}R</span>}
        {card.knowledgeRequirement.blue > 0 && <span>{card.knowledgeRequirement.blue}B</span>}
        {card.knowledgeRequirement.green > 0 && <span>{card.knowledgeRequirement.green}G</span>}
      </div>
    </button>
  );
};

export const AdminSwapModal: React.FC<AdminSwapModalProps> = ({
  handCards,
  deckCards,
  onSwap,
  onClose,
}) => {
  const [selectedHand, setSelectedHand] = useState<string | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const swappingRef = useRef(false);

  const filteredDeck = filter
    ? deckCards.filter(c =>
        c.name.toLowerCase().includes(filter.toLowerCase()) ||
        c.description.toLowerCase().includes(filter.toLowerCase()) ||
        c.type.toLowerCase().includes(filter.toLowerCase())
      )
    : deckCards;

  const handleSwap = useCallback(() => {
    if (selectedHand && selectedDeck && !swappingRef.current) {
      swappingRef.current = true;
      onSwap(selectedHand, selectedDeck);
      setSelectedHand(null);
      setSelectedDeck(null);
      // Re-enable after a short delay to allow deck data to refresh
      setTimeout(() => { swappingRef.current = false; }, 500);
    }
  }, [selectedHand, selectedDeck, onSwap]);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-sand-200">
          <h2 className="font-display text-sm font-bold text-sand-800">Card Swap</h2>
          <button
            onClick={onClose}
            className="text-sand-400 hover:text-sand-600 text-lg leading-none"
          >
            x
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex gap-3 p-4 min-h-0">
          {/* Left: Player's hand */}
          <div className="w-1/3 flex flex-col min-h-0">
            <h3 className="text-xs font-semibold text-sand-600 mb-2">
              Your Hand ({handCards.length})
            </h3>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {handCards.map(c => (
                <MiniCard
                  key={c.id}
                  card={c}
                  selected={selectedHand === c.id}
                  onClick={() => setSelectedHand(selectedHand === c.id ? null : c.id)}
                />
              ))}
              {handCards.length === 0 && (
                <p className="text-[0.65rem] text-sand-400 py-2">No cards in hand.</p>
              )}
            </div>
          </div>

          {/* Right: Deck cards */}
          <div className="w-2/3 flex flex-col min-h-0">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="text-xs font-semibold text-sand-600">
                Deck ({deckCards.length})
              </h3>
              <input
                type="text"
                placeholder="Filter..."
                value={filter}
                onChange={e => setFilter(e.target.value)}
                className="flex-1 px-2 py-1 text-[0.65rem] border border-sand-300 rounded-md focus:outline-none focus:border-blue-400"
              />
            </div>
            <div className="flex-1 overflow-y-auto grid grid-cols-2 gap-1.5 pr-1 auto-rows-min">
              {filteredDeck.map(c => (
                <MiniCard
                  key={c.id}
                  card={c}
                  selected={selectedDeck === c.id}
                  onClick={() => setSelectedDeck(selectedDeck === c.id ? null : c.id)}
                />
              ))}
              {filteredDeck.length === 0 && (
                <p className="text-[0.65rem] text-sand-400 py-2 col-span-2">
                  {deckCards.length === 0 ? 'Deck is empty.' : 'No matches.'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-sand-200 bg-sand-50 rounded-b-xl">
          <div className="text-[0.65rem] text-sand-500">
            {selectedHand && selectedDeck
              ? `Swap "${handCards.find(c => c.id === selectedHand)?.name}" for "${deckCards.find(c => c.id === selectedDeck)?.name}"`
              : 'Select one card from your hand and one from the deck'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-sand-600 hover:text-sand-800 transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleSwap}
              disabled={!selectedHand || !selectedDeck}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Swap
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
