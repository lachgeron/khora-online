import React, { useState, useEffect } from 'react';
import type { EventCard } from '../types';

interface AdminEventModalProps {
  eventCards: EventCard[];
  unusedEvents: EventCard[];
  currentRound: number;
  onReorder: (eventOrder: string[]) => void;
  onClose: () => void;
}

const EventRow: React.FC<{
  card: EventCard;
  roundLabel: number;
  index: number;
  isSwapTarget: boolean;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
  onSelect: () => void;
}> = ({ card, roundLabel, index, isSwapTarget, onMoveUp, onMoveDown, onSelect }) => (
  <div
    onClick={onSelect}
    className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
      isSwapTarget
        ? 'border-terracotta bg-terracotta/10 ring-1 ring-terracotta/40'
        : 'border-sand-300 bg-sand-50 hover:bg-sand-100'
    }`}
  >
    <span className="text-[0.6rem] font-bold text-sand-400 w-6 shrink-0">R{roundLabel}</span>
    <div className="flex-1 min-w-0">
      <span className="font-display text-xs font-semibold text-sand-800">{card.name}</span>
      <p className="text-[0.6rem] text-sand-500 leading-snug truncate">{card.gloryCondition.description}</p>
    </div>
    <div className="flex flex-col gap-0.5 shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); onMoveUp?.(); }}
        disabled={!onMoveUp}
        className="px-1.5 py-0.5 text-[0.6rem] rounded bg-sand-200 hover:bg-sand-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
      >
        &uarr;
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onMoveDown?.(); }}
        disabled={!onMoveDown}
        className="px-1.5 py-0.5 text-[0.6rem] rounded bg-sand-200 hover:bg-sand-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
      >
        &darr;
      </button>
    </div>
  </div>
);

const UnusedEventRow: React.FC<{
  card: EventCard;
  isSwapTarget: boolean;
  onSelect: () => void;
}> = ({ card, isSwapTarget, onSelect }) => (
  <div
    onClick={onSelect}
    className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
      isSwapTarget
        ? 'border-olive bg-olive/10 ring-1 ring-olive/40'
        : 'border-sand-200 bg-white hover:bg-sand-50'
    }`}
  >
    <div className="flex-1 min-w-0">
      <span className="font-display text-xs font-semibold text-sand-700">{card.name}</span>
      <p className="text-[0.6rem] text-sand-400 leading-snug truncate">{card.gloryCondition.description}</p>
    </div>
    <span className="text-[0.55rem] font-semibold text-sand-300 shrink-0 uppercase tracking-wide">Pool</span>
  </div>
);

export const AdminEventModal: React.FC<AdminEventModalProps> = ({
  eventCards,
  unusedEvents,
  currentRound,
  onReorder,
  onClose,
}) => {
  const [order, setOrder] = useState<EventCard[]>(eventCards);
  const [pool, setPool] = useState<EventCard[]>(unusedEvents);

  // Which card is currently selected for swapping: { source: 'deck' | 'pool', id: string }
  const [swapSelection, setSwapSelection] = useState<{ source: 'deck' | 'pool'; id: string } | null>(null);

  // Sync when new data arrives from server
  useEffect(() => {
    setOrder(eventCards);
  }, [eventCards]);

  useEffect(() => {
    setPool(unusedEvents);
  }, [unusedEvents]);

  const moveUp = (index: number) => {
    if (index <= 0) return;
    const next = [...order];
    [next[index - 1], next[index]] = [next[index], next[index - 1]];
    setOrder(next);
  };

  const moveDown = (index: number) => {
    if (index >= order.length - 1) return;
    const next = [...order];
    [next[index], next[index + 1]] = [next[index + 1], next[index]];
    setOrder(next);
  };

  const handleSelectDeck = (cardId: string) => {
    if (!swapSelection) {
      // First click — select from deck
      setSwapSelection({ source: 'deck', id: cardId });
    } else if (swapSelection.source === 'deck') {
      if (swapSelection.id === cardId) {
        // Deselect
        setSwapSelection(null);
      } else {
        // Clicked another deck card — reselect
        setSwapSelection({ source: 'deck', id: cardId });
      }
    } else {
      // swapSelection is from pool, and now we clicked a deck card → perform swap
      const poolCard = pool.find(c => c.id === swapSelection.id);
      const deckIndex = order.findIndex(c => c.id === cardId);
      if (poolCard && deckIndex >= 0) {
        const removedCard = order[deckIndex];
        const newOrder = [...order];
        newOrder[deckIndex] = poolCard;
        setOrder(newOrder);
        setPool(prev => prev.filter(c => c.id !== poolCard.id).concat(removedCard).sort((a, b) => a.name.localeCompare(b.name)));
      }
      setSwapSelection(null);
    }
  };

  const handleSelectPool = (cardId: string) => {
    if (!swapSelection) {
      // First click — select from pool
      setSwapSelection({ source: 'pool', id: cardId });
    } else if (swapSelection.source === 'pool') {
      if (swapSelection.id === cardId) {
        // Deselect
        setSwapSelection(null);
      } else {
        // Clicked another pool card — reselect
        setSwapSelection({ source: 'pool', id: cardId });
      }
    } else {
      // swapSelection is from deck, and now we clicked a pool card → perform swap
      const deckIndex = order.findIndex(c => c.id === swapSelection.id);
      const poolCard = pool.find(c => c.id === cardId);
      if (deckIndex >= 0 && poolCard) {
        const removedCard = order[deckIndex];
        const newOrder = [...order];
        newOrder[deckIndex] = poolCard;
        setOrder(newOrder);
        setPool(prev => prev.filter(c => c.id !== poolCard.id).concat(removedCard).sort((a, b) => a.name.localeCompare(b.name)));
      }
      setSwapSelection(null);
    }
  };

  const handleApply = () => {
    onReorder(order.map(c => c.id));
    setSwapSelection(null);
  };

  const hasChanges = order.some((c, i) => c.id !== eventCards[i]?.id);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-sand-200">
          <h2 className="font-display text-sm font-bold text-sand-800">Event Order</h2>
          <button
            onClick={onClose}
            className="text-sand-400 hover:text-sand-600 text-lg leading-none"
          >
            x
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Queued events */}
          <div>
            <p className="text-[0.65rem] font-semibold text-sand-500 uppercase tracking-wide mb-1.5">
              Upcoming Rounds
            </p>
            <div className="space-y-1.5">
              {order.length === 0 ? (
                <p className="text-[0.7rem] text-sand-400 py-2 text-center">No upcoming events.</p>
              ) : (
                order.map((card, i) => (
                  <EventRow
                    key={card.id}
                    card={card}
                    roundLabel={currentRound + 1 + i}
                    index={i}
                    isSwapTarget={swapSelection?.id === card.id && swapSelection?.source === 'deck'}
                    onMoveUp={i > 0 ? () => moveUp(i) : null}
                    onMoveDown={i < order.length - 1 ? () => moveDown(i) : null}
                    onSelect={() => handleSelectDeck(card.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* Unused event pool */}
          {pool.length > 0 && (
            <div>
              <p className="text-[0.65rem] font-semibold text-sand-500 uppercase tracking-wide mb-1.5">
                Unused Event Pool
              </p>
              {swapSelection && (
                <p className="text-[0.6rem] text-terracotta mb-1.5">
                  {swapSelection.source === 'deck'
                    ? 'Click an unused event below to swap it in'
                    : 'Click a queued event above to swap it out'}
                </p>
              )}
              <div className="space-y-1">
                {pool.map(card => (
                  <UnusedEventRow
                    key={card.id}
                    card={card}
                    isSwapTarget={swapSelection?.id === card.id && swapSelection?.source === 'pool'}
                    onSelect={() => handleSelectPool(card.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-sand-200 bg-sand-50 rounded-b-xl">
          <div className="text-[0.65rem] text-sand-500">
            {swapSelection
              ? 'Select a card to complete the swap'
              : hasChanges
              ? 'Order modified \u2014 click Apply to save'
              : 'Click to select, then click another to swap'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-sand-600 hover:text-sand-800 transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleApply}
              disabled={!hasChanges}
              className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-md font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
