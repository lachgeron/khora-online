import React from 'react';
import type { PoliticsCard } from '../types';

export interface PoliticsMarketProps {
  cards: PoliticsCard[];
  playerCoins: number;
  canPurchase: boolean;
  onPurchase: (cardId: string) => void;
}

/** Displays the politics card market. Req 28.3 */
export const PoliticsMarket: React.FC<PoliticsMarketProps> = ({
  cards,
  playerCoins,
  canPurchase,
  onPurchase,
}) => {
  return (
    <div>
      <h3>Politics Market</h3>
      {cards.length === 0 && <p>No cards available.</p>}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {cards.map((card) => {
          const affordable = playerCoins >= card.cost;
          return (
            <div
              key={card.id}
              style={{
                border: '1px solid #999',
                padding: '8px',
                minWidth: '140px',
                opacity: affordable ? 1 : 0.6,
              }}
            >
              <strong>{card.name}</strong>
              <div>Cost: {card.cost} 💰</div>
              <div>Type: {card.type}</div>
              {canPurchase && (
                <button
                  onClick={() => onPurchase(card.id)}
                  disabled={!affordable}
                >
                  {affordable ? 'Buy' : 'Not enough coins'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
