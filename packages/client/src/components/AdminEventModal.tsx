import React, { useState, useEffect } from 'react';
import type { EventCard } from '../types';

interface AdminEventModalProps {
  eventCards: EventCard[];
  currentRound: number;
  onReorder: (eventOrder: string[]) => void;
  onClose: () => void;
}

const EventRow: React.FC<{
  card: EventCard;
  roundLabel: number;
  index: number;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
}> = ({ card, roundLabel, index, onMoveUp, onMoveDown }) => (
  <div className="flex items-center gap-2 rounded-lg border border-sand-300 bg-sand-50 px-3 py-2">
    <span className="text-[0.6rem] font-bold text-sand-400 w-6 shrink-0">R{roundLabel}</span>
    <div className="flex-1 min-w-0">
      <span className="font-display text-xs font-semibold text-sand-800">{card.name}</span>
      <p className="text-[0.6rem] text-sand-500 leading-snug truncate">{card.gloryCondition.description}</p>
    </div>
    <div className="flex flex-col gap-0.5 shrink-0">
      <button
        onClick={onMoveUp ?? undefined}
        disabled={!onMoveUp}
        className="px-1.5 py-0.5 text-[0.6rem] rounded bg-sand-200 hover:bg-sand-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
      >
        &uarr;
      </button>
      <button
        onClick={onMoveDown ?? undefined}
        disabled={!onMoveDown}
        className="px-1.5 py-0.5 text-[0.6rem] rounded bg-sand-200 hover:bg-sand-300 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
      >
        &darr;
      </button>
    </div>
  </div>
);

export const AdminEventModal: React.FC<AdminEventModalProps> = ({
  eventCards,
  currentRound,
  onReorder,
  onClose,
}) => {
  const [order, setOrder] = useState<EventCard[]>(eventCards);

  // Sync when new data arrives
  useEffect(() => {
    setOrder(eventCards);
  }, [eventCards]);

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

  const handleApply = () => {
    onReorder(order.map(c => c.id));
  };

  const hasChanges = order.some((c, i) => c.id !== eventCards[i]?.id);

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-sand-200">
          <h2 className="font-display text-sm font-bold text-sand-800">Event Order</h2>
          <button
            onClick={onClose}
            className="text-sand-400 hover:text-sand-600 text-lg leading-none"
          >
            x
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {order.length === 0 ? (
            <p className="text-[0.7rem] text-sand-400 py-2 text-center">No upcoming events.</p>
          ) : (
            order.map((card, i) => (
              <EventRow
                key={card.id}
                card={card}
                roundLabel={currentRound + 1 + i}
                index={i}
                onMoveUp={i > 0 ? () => moveUp(i) : null}
                onMoveDown={i < order.length - 1 ? () => moveDown(i) : null}
              />
            ))
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-sand-200 bg-sand-50 rounded-b-xl">
          <div className="text-[0.65rem] text-sand-500">
            {hasChanges ? 'Order modified — click Apply to save' : 'Drag events to reorder'}
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
