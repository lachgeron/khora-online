import React from 'react';
import type { PrivatePlayerState, PublicPlayerState, CityCard } from '../types';
import { motion } from 'framer-motion';

export interface PlayerBoardProps {
  publicState: PublicPlayerState;
  privateState?: PrivatePlayerState | null;
  cityCard?: CityCard;
  onActivateDev?: (devId: string) => void;
}

const MILESTONES: Record<string, Record<number, string>> = {
  Economy: { 2: '+3 citizens', 3: '+3 citizens', 4: '+5 VP', 5: '+5 citizens', 7: '+10 VP' },
  Culture: { 3: '+1 tax', 4: '3rd die', 5: '+1 tax', 6: '+1 tax', 7: '+2 tax' },
  Military: { 2: '+1 glory', 4: '+1 glory', 6: '+1 glory', 7: '+2 glory' },
};

const PROGRESS_COSTS: Record<string, Record<number, number>> = {
  Economy: { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 },
  Culture: { 1: 1, 2: 4, 3: 6, 4: 6, 5: 7, 6: 7 },
  Military: { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9 },
};

const Track: React.FC<{ label: string; value: number; max: number; color: string }> = ({ label, value, max, color }) => {
  const milestones = MILESTONES[label] ?? {};
  const costs = PROGRESS_COSTS[label] ?? {};
  const cells = Array.from({ length: max }, (_, i) => i + 1);

  return (
    <div className="mb-2.5">
      <span className="block w-16 text-[0.65rem] font-semibold uppercase tracking-wide text-sand-500 mb-0.5">{label}</span>
      <div className="flex gap-px">
        {cells.map(lvl => {
          const filled = lvl <= value;
          const milestone = milestones[lvl];
          return (
            <div
              key={lvl}
              className="relative flex-1 group"
              title={milestone ? `Level ${lvl}: ${milestone}` : `Level ${lvl}`}
            >
              <div
                className={`h-6 flex items-center justify-center text-[0.55rem] font-bold transition-colors ${
                  lvl === 1 ? 'rounded-l-md' : ''
                } ${lvl === max ? 'rounded-r-md' : ''} ${
                  filled ? 'text-white' : 'text-sand-400'
                }`}
                style={{ background: filled ? color : undefined, backgroundColor: filled ? undefined : '#e8dcc6' }}
              >
                {lvl}
              </div>
              {milestone && (
                <div className={`absolute -bottom-3.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${
                  filled ? 'bg-sand-500' : 'bg-gold'
                }`} />
              )}
              {/* Tooltip on hover */}
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 pointer-events-none">
                <div className="bg-sand-800 text-sand-100 text-[0.6rem] px-2 py-1 rounded whitespace-nowrap shadow-lg">
                  {!filled && costs[lvl - 1] != null && <span>{costs[lvl - 1]} 💰</span>}
                  {!filled && costs[lvl - 1] != null && milestone && <span> · </span>}
                  {milestone && <span>{milestone}</span>}
                  {filled && !milestone && <span>Level {lvl}</span>}
                  {!filled && costs[lvl - 1] == null && !milestone && <span>Level {lvl}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const PlayerBoard: React.FC<PlayerBoardProps> = ({ publicState: p, privateState: pr, cityCard, onActivateDev }) => {
  const isOwn = !!pr;
  const tokens = { red: { M: 0, m: 0 }, blue: { M: 0, m: 0 }, green: { M: 0, m: 0 } };
  for (const t of p.knowledgeTokens) {
    const c = t.color.toLowerCase() as 'red' | 'blue' | 'green';
    tokens[c][t.tokenType === 'MAJOR' ? 'M' : 'm']++;
  }

  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <h3 className="font-display text-base font-semibold text-sand-800">
          {p.playerName}
          {!p.isConnected && <span className="text-crimson ml-1.5 text-sm" title="Disconnected">●</span>}
        </h3>
        <p className="text-[0.7rem] text-sand-500">{p.cityId}</p>
      </div>

      {/* City Developments */}
      {cityCard && (
        <section>
          <p className="font-display text-[0.6rem] uppercase tracking-[0.14em] text-sand-500 mb-1">Developments ({p.developmentLevel}/4)</p>
          <div className="space-y-1">
            {cityCard.developments.map((dev, i) => {
              const isUnlocked = i < p.developmentLevel;
              const isNext = i === p.developmentLevel;
              return (
                <div key={dev.id} className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-[0.7rem] ${
                  isUnlocked ? 'bg-emerald-50 border border-emerald-200' :
                  isNext ? 'bg-sand-100 border border-sand-300' :
                  'bg-sand-100/50 border border-sand-200/50 opacity-50'
                }`}>
                  <span className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[0.5rem] font-bold ${
                    isUnlocked ? 'bg-emerald-500 text-white' : 'bg-sand-300 text-sand-600'
                  }`}>
                    {isUnlocked ? '✓' : i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className={`font-medium ${isUnlocked ? 'text-emerald-800' : 'text-sand-700'}`}>{dev.name}</span>
                    {isUnlocked && dev.effectType === 'ONGOING' && onActivateDev && dev.id === 'thebes-dev-2' && p.gloryTrack > 0 && (
                      <button
                        onClick={() => onActivateDev(dev.id)}
                        className="ml-2 px-2 py-0.5 text-[0.55rem] font-bold bg-gold text-sand-900 rounded hover:bg-gold-dim transition-colors"
                      >
                        Use (-1 Glory → +2💰 +4★)
                      </button>
                    )}
                    {!isUnlocked && (
                      <div className="text-[0.6rem] text-sand-400 mt-0.5">
                        {dev.drachmaCost > 0 && `${dev.drachmaCost}💰 `}
                        {dev.knowledgeRequirement.red > 0 && `${dev.knowledgeRequirement.red}🔴 `}
                        {dev.knowledgeRequirement.blue > 0 && `${dev.knowledgeRequirement.blue}🔵 `}
                        {dev.knowledgeRequirement.green > 0 && `${dev.knowledgeRequirement.green}🟢`}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Progress */}
      <section>
        <p className="font-display text-[0.6rem] uppercase tracking-[0.14em] text-sand-500 mb-1">Progress</p>
        <Track label="Economy" value={p.economyTrack} max={7} color="linear-gradient(90deg, #c9a84c, #e0c060)" />
        <Track label="Culture" value={p.cultureTrack} max={7} color="linear-gradient(90deg, #7a9450, #96b868)" />
        <Track label="Military" value={p.militaryTrack} max={7} color="linear-gradient(90deg, #b85c38, #d47050)" />
      </section>

      {/* Secondary tracks */}
      <section>
        <p className="font-display text-[0.6rem] uppercase tracking-[0.14em] text-sand-500 mb-1">Tracks</p>
        <Track label="Tax" value={p.taxTrack} max={10} color="linear-gradient(90deg, #8b6914, #a88020)" />
        <Track label="Glory" value={p.gloryTrack} max={10} color="linear-gradient(90deg, #9060a0, #b080c0)" />
        <Track label="Troops" value={p.troopTrack} max={15} color="linear-gradient(90deg, #606878, #808890)" />
        <Track label="Citizens" value={p.citizenTrack} max={15} color="linear-gradient(90deg, #4a7a9e, #60a0c8)" />
      </section>

      {/* Resources */}
      <section>
        <p className="font-display text-[0.6rem] uppercase tracking-[0.14em] text-sand-500 mb-1">Resources</p>
        <div className="flex flex-wrap gap-1.5">
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-sand-200 border border-sand-300 rounded-full text-xs">
            <span className="font-bold text-sm">{p.coins}</span> 💰
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-sand-200 border border-sand-300 rounded-full text-xs">
            <span className="font-bold text-sm">{p.philosophyTokens}</span> 📜
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-sand-200 border border-sand-300 rounded-full text-xs">
            <span className="font-bold text-sm">{p.victoryPoints}</span> ★
          </span>
          {!isOwn && (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-sand-200 border border-sand-300 rounded-full text-xs">
              <span className="font-bold text-sm">{p.handCardCount}</span> 🃏
            </span>
          )}
          <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 border rounded-full text-xs ${
            p.timeBankMs <= 0 ? 'bg-red-100 border-red-300 text-red-700' :
            p.timeBankMs <= 30_000 ? 'bg-amber-100 border-amber-300 text-amber-700' :
            'bg-sand-200 border-sand-300'
          }`}>
            <span className="font-bold text-sm">{Math.ceil(p.timeBankMs / 1000)}s</span> ⏳
          </span>
        </div>
      </section>

      {/* Knowledge tokens */}
      {p.knowledgeTokens.length > 0 && (
        <section>
          <p className="font-display text-[0.6rem] uppercase tracking-[0.14em] text-sand-500 mb-1">Tokens</p>
          <div className="flex flex-wrap gap-1.5">
            {(['red', 'blue', 'green'] as const).map(color => {
              const c = tokens[color];
              if (c.M + c.m === 0) return null;
              const bg = color === 'red' ? 'bg-token-red' : color === 'blue' ? 'bg-token-blue' : 'bg-token-green';
              return (
                <span key={color} className="inline-flex items-center gap-1 px-2 py-0.5 bg-sand-200 border border-sand-300 rounded-full text-xs">
                  <span className={`w-2.5 h-2.5 rounded-full ${bg}`} />
                  {c.m > 0 && <span>{c.m}m</span>}
                  {c.M > 0 && <span className="font-bold">{c.M}M</span>}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {/* Dice */}
      {(isOwn ? pr?.diceRoll : p.diceRoll) && (
        <section>
          <p className="font-display text-[0.6rem] uppercase tracking-[0.14em] text-sand-500 mb-1">Dice</p>
          <div className="flex gap-2">
            {(isOwn ? pr!.diceRoll! : p.diceRoll!).map((d, i) => (
              <motion.span
                key={i}
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: i * 0.1, type: 'spring', stiffness: 300 }}
                className="w-9 h-9 flex items-center justify-center bg-sand-800 text-sand-100 rounded-lg font-bold text-lg shadow-md"
              >
                {d}
              </motion.span>
            ))}
          </div>
        </section>
      )}

      {/* Action slots (own: detailed with die values; other: type + resolved) */}
      {isOwn && pr && pr.actionSlots.some(s => s !== null) && (
        <section>
          <p className="font-display text-[0.6rem] uppercase tracking-[0.14em] text-sand-500 mb-1">Actions</p>
          <div className="space-y-0.5">
            {pr.actionSlots.map((slot, i) =>
              slot ? (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-6 h-6 flex items-center justify-center bg-sand-700 text-sand-100 rounded font-bold text-[0.7rem]">{slot.assignedDie}</span>
                  <span className="font-medium">{slot.actionType}</span>
                  {slot.resolved && <span className="text-olive-light font-bold">✓</span>}
                </div>
              ) : null,
            )}
          </div>
        </section>
      )}
      {!isOwn && p.actionSlots.length > 0 && (
        <section>
          <p className="font-display text-[0.6rem] uppercase tracking-[0.14em] text-sand-500 mb-1">Actions</p>
          <div className="space-y-0.5">
            {p.actionSlots.map((slot, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="font-medium">{slot.actionType}</span>
                {slot.resolved && <span className="text-olive-light font-bold">✓</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Played card summaries (other players only) */}
      {!isOwn && p.playedCardSummaries.length > 0 && (
        <section>
          <p className="font-display text-[0.6rem] uppercase tracking-[0.14em] text-sand-500 mb-1">In Play ({p.playedCardCount})</p>
          <div className="space-y-1.5">
            {p.playedCardSummaries.map((c, i) => {
              const typeColor = c.type === 'IMMEDIATE' ? 'bg-amber-100 text-amber-800' : c.type === 'ONGOING' ? 'bg-emerald-100 text-emerald-800' : 'bg-purple-100 text-purple-800';
              return (
                <div key={i} className="bg-sand-50 border border-sand-300 rounded-lg p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-display text-xs font-semibold text-sand-800">{c.name}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase ${typeColor}`}>
                      {c.type.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-[0.65rem] text-sand-600 mt-1 leading-snug">{c.description}</p>
                </div>
              );
            })}
          </div>
        </section>
      )}

    </div>
  );
};
