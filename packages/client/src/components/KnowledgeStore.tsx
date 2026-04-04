import React from 'react';
import type { KnowledgeToken } from '../types';

interface KnowledgeStoreProps {
  tokens: KnowledgeToken[];
  /** If set, tokens become selectable and this is the currently selected token ID */
  selectedTokenId?: string;
  /** Called when a token is clicked in selection mode */
  onSelectToken?: (tokenId: string | null) => void;
  /** Troops available for exploration (used to determine which tokens are affordable) */
  availableTroops?: number;
  /** Use compact vertical layout (for narrow containers like sidebar) */
  compact?: boolean;
}

const COL = {
  RED:   { bg: '#c44040', light: '#fce8e8', mid: '#e8a0a0', text: '#922020' },
  BLUE:  { bg: '#4060c4', light: '#e8ecfa', mid: '#a0b0e0', text: '#203080' },
  GREEN: { bg: '#40a050', light: '#e8f5ea', mid: '#a0d0a8', text: '#206030' },
} as const;

export const KnowledgeStore: React.FC<KnowledgeStoreProps> = ({
  tokens, selectedTokenId, onSelectToken, availableTroops, compact,
}) => {
  if (tokens.length === 0) return null;
  const isSelectable = !!onSelectToken;

  const regularTokens = tokens.filter(t => !t.isPersepolis);
  const persepolis = tokens.find(t => t.isPersepolis);

  return (
    <div>
      <p className="font-display text-[0.65rem] uppercase tracking-[0.12em] text-sand-600 mb-3">
        Knowledge Store
        {isSelectable && <span className="text-gold-dim ml-1">— tap to explore</span>}
      </p>
      <div className={compact ? 'space-y-3' : 'flex gap-4'}>
        {(['RED', 'BLUE', 'GREEN'] as const).map(color => {
          const c = COL[color];
          const colorTokens = regularTokens.filter(t => t.color === color)
            .sort((a, b) => (a.militaryRequirement ?? 0) - (b.militaryRequirement ?? 0));
          if (colorTokens.length === 0) return (
            <div key={color} className={`${compact ? '' : 'flex-1'} text-center text-xs text-sand-400 py-2`}>
              No {color.toLowerCase()} tokens
            </div>
          );

          return (
            <div key={color} className={compact ? '' : 'flex-1'}>
              {/* Column header */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="w-3 h-3 rounded-full shadow-sm" style={{ background: c.bg }} />
                <span className="text-xs font-display font-bold uppercase tracking-wider" style={{ color: c.bg }}>
                  {color}
                </span>
                <span className="text-[0.6rem] text-sand-400 ml-auto">{colorTokens.length}</span>
              </div>

              {/* Tokens */}
              <div className={compact ? 'space-y-1' : 'space-y-1'}>
                {colorTokens.map(t => {
                  const isMajor = t.tokenType === 'MAJOR';
                  const isSelected = selectedTokenId === t.id;
                  const isExplored = t.explored === true;
                  const canAfford = !isExplored && (availableTroops !== undefined ? availableTroops >= (t.militaryRequirement ?? 0) : true);
                  const hasBonus = (t.bonusCoins ?? 0) > 0 || (t.bonusVP ?? 0) > 0;

                  if (compact) {
                    return (
                      <div
                        key={t.id}
                        onClick={() => isSelectable && canAfford && !isExplored && onSelectToken(isSelected ? null : t.id)}
                        className={`flex items-center gap-2 rounded-md px-2 py-1.5 transition-all ${
                          isExplored ? 'opacity-30 grayscale cursor-default' :
                          isSelectable ? (
                            !canAfford ? 'opacity-30 cursor-not-allowed' :
                            isSelected ? 'ring-2 ring-gold bg-gold/10 cursor-pointer' :
                            'hover:brightness-95 cursor-pointer'
                          ) : ''
                        }`}
                        style={{ background: isExplored ? '#e8e4df' : `${c.light}80` }}
                      >
                        <span
                          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white text-[0.6rem] font-bold shadow-sm"
                          style={{
                            background: c.bg,
                            outline: isMajor ? `2px solid ${c.mid}` : 'none',
                            outlineOffset: '1.5px',
                          }}
                        >
                          {isMajor ? 'M' : 'm'}
                        </span>
                        <div className="flex-1 min-w-0 flex items-center gap-2 text-[0.6rem]">
                          <span className="font-semibold" style={{ color: c.text }}>⚔ {t.militaryRequirement}</span>
                          <span className="text-sand-400">-{t.skullValue} troops</span>
                        </div>
                        {hasBonus && (
                          <div className="shrink-0 text-[0.55rem] font-bold">
                            {(t.bonusCoins ?? 0) > 0 && <span className="text-amber-600">+{t.bonusCoins}💰 </span>}
                            {(t.bonusVP ?? 0) > 0 && <span className="text-purple-600">+{t.bonusVP}★</span>}
                          </div>
                        )}
                        {isSelectable && canAfford && !isExplored && (
                          <span className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center text-[0.4rem] font-bold transition-colors ${
                            isSelected ? 'bg-gold border-gold text-sand-900' : 'border-sand-300'
                          }`}>
                            {isSelected && '✓'}
                          </span>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={t.id}
                      onClick={() => isSelectable && canAfford && !isExplored && onSelectToken(isSelected ? null : t.id)}
                      className={`flex items-center gap-2 rounded-lg px-2.5 py-2 transition-all ${
                        isExplored ? 'opacity-30 grayscale cursor-default' :
                        isSelectable ? (
                          !canAfford ? 'opacity-30 cursor-not-allowed' :
                          isSelected ? 'ring-2 ring-gold bg-gold/10 cursor-pointer shadow-sm' :
                          'hover:bg-sand-100 cursor-pointer'
                        ) : ''
                      }`}
                      style={{ background: isExplored ? '#e8e4df' : isSelected ? undefined : `${c.light}60` }}
                    >
                      {/* Token circle */}
                      <span
                        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm"
                        style={{
                          background: c.bg,
                          outline: isMajor ? `2.5px solid ${c.mid}` : 'none',
                          outlineOffset: '2px',
                        }}
                      >
                        {t.militaryRequirement}
                      </span>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold" style={{ color: c.text }}>
                            {isMajor ? 'Major' : 'Minor'}
                          </span>
                          <span className="text-[0.65rem] text-sand-400">
                            ⚔ -{t.skullValue} troops
                          </span>
                        </div>
                        {hasBonus && (
                          <div className="text-[0.65rem] font-medium mt-0.5">
                            {(t.bonusCoins ?? 0) > 0 && <span className="text-amber-600">+{t.bonusCoins} 💰 </span>}
                            {(t.bonusVP ?? 0) > 0 && <span className="text-purple-600">+{t.bonusVP} ★</span>}
                          </div>
                        )}
                      </div>

                      {/* Selection indicator */}
                      {isSelectable && canAfford && !isExplored && (
                        <span className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                          isSelected ? 'bg-gold border-gold text-sand-900 text-[0.5rem] font-bold' : 'border-sand-300'
                        }`}>
                          {isSelected && '✓'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Persepolis */}
      {persepolis && (() => {
        const persepolisExplored = persepolis.explored === true;
        const persepolisAffordable = !persepolisExplored && (availableTroops === undefined || availableTroops >= 15);
        return (
        <div
          onClick={() => isSelectable && persepolisAffordable && onSelectToken?.(selectedTokenId === persepolis.id ? null : persepolis.id)}
          className={`mt-4 rounded-xl border-2 p-4 transition-all ${
            persepolisExplored ? 'opacity-30 grayscale border-sand-200 cursor-default' :
            isSelectable ? (
              !persepolisAffordable ? 'opacity-30 cursor-not-allowed border-sand-200' :
              selectedTokenId === persepolis.id ? 'ring-2 ring-gold bg-gold/10 border-gold cursor-pointer shadow-md' :
              'border-sand-300 hover:border-sand-500 cursor-pointer'
            ) : 'border-sand-300'
          }`}
          style={{ background: persepolisExplored ? '#e8e4df' : selectedTokenId === persepolis.id ? undefined : 'linear-gradient(135deg, rgba(196,64,64,0.06), rgba(64,96,196,0.06), rgba(64,160,80,0.06))' }}
        >
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              <span className="w-6 h-6 rounded-full bg-token-red flex items-center justify-center text-white text-[0.5rem] font-bold shadow-sm" style={{ outline: '2px solid #e8a0a0', outlineOffset: '2px' }}>M</span>
              <span className="w-6 h-6 rounded-full bg-token-blue flex items-center justify-center text-white text-[0.5rem] font-bold shadow-sm" style={{ outline: '2px solid #a0b0e0', outlineOffset: '2px' }}>M</span>
              <span className="w-6 h-6 rounded-full bg-token-green flex items-center justify-center text-white text-[0.5rem] font-bold shadow-sm" style={{ outline: '2px solid #a0d0a8', outlineOffset: '2px' }}>M</span>
            </div>
            <div className="flex-1">
              <p className="font-display text-sm font-bold text-sand-800">Persepolis</p>
              <p className="text-[0.65rem] text-sand-500">1 Major of each color · Requires 15 troops · Costs 15 troops</p>
            </div>
            {isSelectable && persepolisAffordable && (
              <span className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                selectedTokenId === persepolis.id ? 'bg-gold border-gold text-sand-900 text-[0.5rem] font-bold' : 'border-sand-300'
              }`}>
                {selectedTokenId === persepolis.id && '✓'}
              </span>
            )}
          </div>
        </div>
        );
      })()}
    </div>
  );
};
