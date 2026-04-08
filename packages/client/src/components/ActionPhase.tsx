import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type {
  ActionType,
  ActionChoices,
  PoliticsCard,
  KnowledgeColor,
  KnowledgeToken,
  ProgressTrackType,
} from '../types';
import { KnowledgeStore } from './KnowledgeStore';
import { CountdownTimer } from './CountdownTimer';

const BASE_MINOR_KNOWLEDGE_COST = 5;
const CORINTHIAN_COLUMNS_COST = 3;

const ACTION_INFO: Record<ActionType, { icon: string; label: string; color: string }> = {
  PHILOSOPHY: { icon: '📜', label: 'Philosophy', color: '#9060a0' },
  LEGISLATION: { icon: '📋', label: 'Legislation', color: '#4a7a9e' },
  CULTURE: { icon: '🎭', label: 'Culture', color: '#7a9450' },
  TRADE: { icon: '💰', label: 'Trade', color: '#c9a84c' },
  MILITARY: { icon: '⚔️', label: 'Military', color: '#b85c38' },
  POLITICS: { icon: '🏛', label: 'Politics', color: '#606878' },
  DEVELOPMENT: { icon: '🔨', label: 'Development', color: '#8b6914' },
};

const TOKEN_COLORS: Record<string, { bg: string; label: string }> = {
  RED: { bg: '#c44040', label: 'Red' },
  BLUE: { bg: '#4060c4', label: 'Blue' },
  GREEN: { bg: '#40a050', label: 'Green' },
};

export interface ActionPhaseProps {
  actionType: ActionType;
  handCards?: PoliticsCard[];
  playerCoins?: number;
  playerEconomyTrack?: number;
  playerMilitaryTrack?: number;
  playerTroopTrack?: number;
  playerKnowledgeTokens?: KnowledgeToken[];
  philosophyTokens?: number;
  developmentLevel?: number;
  cityId?: string;
  cityDevelopments?: { id?: string; name: string; drachmaCost: number; knowledgeRequirement: { red: number; blue: number; green: number } }[];
  centralBoardTokens?: KnowledgeToken[];
  legislationDraw?: PoliticsCard[] | null;
  playedCards?: PoliticsCard[];
  onResolve: (actionType: ActionType, choices: ActionChoices) => void;
  onSkip: () => void;
  timeoutAt?: number;
  usingTimeBank?: boolean;
}

export const ActionPhase: React.FC<ActionPhaseProps> = ({
  actionType, handCards, playerCoins, playerEconomyTrack, playerMilitaryTrack, playerTroopTrack,
  playerKnowledgeTokens, philosophyTokens: philTokens, developmentLevel, cityId, cityDevelopments,
  centralBoardTokens, legislationDraw, playedCards, onResolve, onSkip, timeoutAt, usingTimeBank,
}) => {
  const [buyToken, setBuyToken] = useState(false);
  const [tokenColor, setTokenColor] = useState<KnowledgeColor>('GREEN');
  const [exploreTokenId, setExploreTokenId] = useState('');
  const [secondExploreTokenId, setSecondExploreTokenId] = useState('');
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [useScrollsForCard, setUseScrollsForCard] = useState(false);
  const [useScrollsForDev, setUseScrollsForDev] = useState(false);
  const [devTrackChoices, setDevTrackChoices] = useState<ProgressTrackType[]>([]);
  const [scholarlyColor, setScholarlyColor] = useState<KnowledgeColor>('GREEN');
  const [ostracismReturnId, setOstracismReturnId] = useState<string | null>(null);
  const [argosReward, setArgosReward] = useState<'troops' | 'coins' | 'vp' | 'citizens'>('vp');
  const [spartaExploreTokenIds, setSpartaExploreTokenIds] = useState<string[]>([]);

  const coins = playerCoins ?? 0;
  const scrolls = philTokens ?? 0;
  const tokens = playerKnowledgeTokens ?? [];
  const tokenCounts = { red: 0, blue: 0, green: 0 };
  for (const t of tokens) tokenCounts[t.color.toLowerCase() as 'red' | 'blue' | 'green']++;

  const meetsReq = (req: { red: number; blue: number; green: number }) =>
    tokenCounts.red >= req.red && tokenCounts.blue >= req.blue && tokenCounts.green >= req.green;

  /** Calculate how many philosophy pairs are needed to cover a knowledge shortfall. */
  const getKnowledgeShortfall = (req: { red: number; blue: number; green: number }): number => {
    const redShort = Math.max(0, req.red - tokenCounts.red);
    const blueShort = Math.max(0, req.blue - tokenCounts.blue);
    const greenShort = Math.max(0, req.green - tokenCounts.green);
    return redShort + blueShort + greenShort;
  };

  /** Check if a knowledge requirement can be met using philosophy scrolls. */
  const canMeetWithScrolls = (req: { red: number; blue: number; green: number }): boolean => {
    const shortfall = getKnowledgeShortfall(req);
    if (shortfall === 0) return true; // Already meets requirement
    return scrolls >= shortfall * 2;
  };

  const getCardBlockReason = (card: PoliticsCard, withScrolls: boolean = false): string | null => {
    if (coins < card.cost) return `Need ${card.cost} drachma (have ${coins})`;
    if (!meetsReq(card.knowledgeRequirement)) {
      if (withScrolls && canMeetWithScrolls(card.knowledgeRequirement)) return null;
      const missing: string[] = [];
      if (tokenCounts.red < card.knowledgeRequirement.red) missing.push(`${card.knowledgeRequirement.red - tokenCounts.red} more red`);
      if (tokenCounts.blue < card.knowledgeRequirement.blue) missing.push(`${card.knowledgeRequirement.blue - tokenCounts.blue} more blue`);
      if (tokenCounts.green < card.knowledgeRequirement.green) missing.push(`${card.knowledgeRequirement.green - tokenCounts.green} more green`);
      return `Need ${missing.join(', ')} token${missing.length > 1 ? 's' : ''}`;
    }
    return null;
  };

  const info = ACTION_INFO[actionType];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* Action header */}
      <div className="mb-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{info.icon}</span>
          <div>
            <h3 className="font-display text-lg font-bold" style={{ color: info.color }}>{info.label}</h3>
            <p className="text-xs text-sand-500">Resolve this action</p>
          </div>
        </div>
        {timeoutAt && (
          <div className="mt-3">
            <CountdownTimer timeoutAt={timeoutAt} usingTimeBank={usingTimeBank} />
          </div>
        )}
      </div>

      {/* ── POLITICS ── */}
      {actionType === 'POLITICS' && handCards && (
        <div className="space-y-2">
          {handCards.every(c => getCardBlockReason(c, true) !== null) ? (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-800 font-medium">No playable cards</p>
              <p className="text-xs text-red-600 mt-1">None of your cards can be played right now. You may need more drachma or knowledge tokens.</p>
            </div>
          ) : (
            <p className="text-sm text-sand-600">Choose a card from your hand to play:</p>
          )}
          <AnimatePresence>
            {handCards.map((card, i) => {
              const needsScrolls = !meetsReq(card.knowledgeRequirement) && canMeetWithScrolls(card.knowledgeRequirement) && coins >= card.cost;
              const blockReason = getCardBlockReason(card, useScrollsForCard);
              const isBlocked = blockReason !== null;
              const isSelected = selectedCardId === card.id;
              const shortfall = getKnowledgeShortfall(card.knowledgeRequirement);
              const scrollCost = shortfall * 2;
              const typeColor = card.type === 'IMMEDIATE' ? 'bg-amber-100 text-amber-800' : card.type === 'ONGOING' ? 'bg-emerald-100 text-emerald-800' : 'bg-purple-100 text-purple-800';
              return (
                <motion.div
                  key={card.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => !isBlocked && setSelectedCardId(card.id)}
                  className={`rounded-lg border-2 p-3 transition-all ${
                    isBlocked
                      ? 'border-sand-200 bg-sand-100 opacity-50 cursor-not-allowed'
                      : isSelected
                      ? 'border-gold bg-gold/5 shadow-md cursor-pointer'
                      : 'border-sand-200 bg-sand-50 hover:border-sand-400 cursor-pointer'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-display text-sm font-semibold text-sand-800">{card.name}</span>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-[0.6rem] font-bold uppercase ${typeColor}`}>
                      {card.type.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-sand-500 mt-1">{card.description}</p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-sand-400">
                    {card.cost > 0 && <span>{card.cost} 💰</span>}
                    {card.knowledgeRequirement.red > 0 && <span>{card.knowledgeRequirement.red} 🔴</span>}
                    {card.knowledgeRequirement.blue > 0 && <span>{card.knowledgeRequirement.blue} 🔵</span>}
                    {card.knowledgeRequirement.green > 0 && <span>{card.knowledgeRequirement.green} 🟢</span>}
                    {card.cost === 0 && !card.knowledgeRequirement.red && !card.knowledgeRequirement.blue && !card.knowledgeRequirement.green && <span>Free</span>}
                  </div>
                  {isBlocked && needsScrolls && !useScrollsForCard && (
                    <div className="mt-2 rounded bg-purple-50 border border-purple-200 p-2">
                      <p className="text-[0.65rem] text-purple-700">
                        📜 Use {scrollCost} scrolls to cover missing tokens?
                      </p>
                      <button
                        onClick={(e) => { e.stopPropagation(); setUseScrollsForCard(true); setSelectedCardId(card.id); }}
                        className="mt-1 px-3 py-1 bg-purple-600 text-white rounded text-[0.65rem] font-semibold hover:bg-purple-700 transition-colors"
                      >
                        Use Scrolls ({scrolls} available)
                      </button>
                    </div>
                  )}
                  {isBlocked && !needsScrolls && (
                    <p className="text-[0.65rem] text-red-500 mt-1.5 font-medium">⚠ {blockReason}</p>
                  )}
                  {isSelected && !isBlocked && (
                    <div>
                      {needsScrolls && useScrollsForCard && (
                        <div className="mt-2 rounded bg-purple-50 border border-purple-200 p-2 flex items-center justify-between">
                          <span className="text-[0.65rem] text-purple-700 font-medium">📜 Using {scrollCost} scrolls for knowledge</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); setUseScrollsForCard(false); }}
                            className="text-[0.6rem] text-purple-500 hover:text-purple-700 underline"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {/* Scholarly Welcome: choose token color */}
                      {card.id === 'scholarly-welcome' && (
                        <div className="mt-2 rounded bg-emerald-50 border border-emerald-200 p-2">
                          <p className="text-[0.65rem] text-emerald-700 font-medium mb-1.5">Choose a minor token color:</p>
                          <div className="flex gap-2">
                            {(['GREEN', 'BLUE', 'RED'] as KnowledgeColor[]).map(color => {
                              const tc = TOKEN_COLORS[color];
                              return (
                                <button
                                  key={color}
                                  onClick={(e) => { e.stopPropagation(); setScholarlyColor(color); }}
                                  className={`flex-1 py-2 rounded-lg border-2 flex flex-col items-center gap-1 transition-all ${
                                    scholarlyColor === color
                                      ? 'border-sand-700 shadow-md scale-105'
                                      : 'border-sand-200 hover:border-sand-400'
                                  }`}
                                >
                                  <span className="w-5 h-5 rounded-full shadow" style={{ background: tc.bg }} />
                                  <span className="text-[0.6rem] font-semibold text-sand-700">{tc.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {/* Ostracism: choose card to return */}
                      {card.id === 'ostracism' && playedCards && playedCards.filter(c => c.id !== 'ostracism').length > 0 && (
                        <div className="mt-2 rounded bg-amber-50 border border-amber-200 p-2">
                          <p className="text-[0.65rem] text-amber-700 font-medium mb-1.5">Choose a card to return to your hand:</p>
                          <div className="space-y-1">
                            {playedCards.filter(c => c.id !== 'ostracism').map(pc => (
                              <button
                                key={pc.id}
                                onClick={(e) => { e.stopPropagation(); setOstracismReturnId(pc.id); }}
                                className={`w-full text-left px-2 py-1.5 rounded border text-[0.65rem] transition-all ${
                                  ostracismReturnId === pc.id
                                    ? 'border-gold bg-gold/10 font-semibold text-sand-800'
                                    : 'border-sand-200 bg-sand-50 text-sand-600 hover:border-sand-400'
                                }`}
                              >
                                {pc.name}
                              </button>
                            ))}
                          </div>
                          <p className="text-[0.55rem] text-amber-600 mt-1.5">You'll then get a bonus politics action.</p>
                        </div>
                      )}
                      <motion.button
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          const pairs = (useScrollsForCard && shortfall > 0) ? shortfall : undefined;
                          const resolveChoices: ActionChoices = { targetCardId: card.id, philosophyPairsToUse: pairs };
                          if (card.id === 'scholarly-welcome') resolveChoices.scholarlyWelcomeColor = scholarlyColor;
                          if (card.id === 'ostracism' && ostracismReturnId) resolveChoices.ostracismReturnCardId = ostracismReturnId;
                          onResolve(actionType, resolveChoices);
                        }}
                        disabled={card.id === 'ostracism' && playedCards && playedCards.filter(c => c.id !== 'ostracism').length > 0 && !ostracismReturnId}
                        className="mt-3 w-full py-2 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        Play {card.name}{useScrollsForCard && shortfall > 0 ? ` (−${scrollCost} 📜)` : ''}
                      </motion.button>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ── TRADE ── */}
      {actionType === 'TRADE' && (() => {
        const hasCorinthianColumns = playedCards?.some(c => c.id === 'corinthian-columns') ?? false;
        const minorCost = hasCorinthianColumns ? CORINTHIAN_COLUMNS_COST : BASE_MINOR_KNOWLEDGE_COST;
        return (
        <div className="space-y-4">
          <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
            <p className="text-sm text-amber-800 font-medium">
              Gain <span className="font-bold">{(playerEconomyTrack ?? 0) + 1}</span> drachma (Economy {playerEconomyTrack ?? 0} + 1)
            </p>
          </div>

          <div className="rounded-lg border-2 border-sand-200 p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                buyToken ? 'bg-gold border-gold' : 'border-sand-400'
              }`}
                onClick={() => setBuyToken(!buyToken)}
              >
                {buyToken && <span className="text-sand-900 text-xs font-bold">✓</span>}
              </div>
              <span className="text-sm font-medium text-sand-800">
                Buy a Minor Knowledge token ({minorCost} 💰)
                {hasCorinthianColumns && <span className="text-emerald-600 text-xs ml-1">(Corinthian Columns)</span>}
              </span>
            </label>

            <AnimatePresence>
              {buyToken && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex gap-2 mt-3">
                    {(['GREEN', 'BLUE', 'RED'] as KnowledgeColor[]).map(color => {
                      const tc = TOKEN_COLORS[color];
                      return (
                        <button
                          key={color}
                          onClick={() => setTokenColor(color)}
                          className={`flex-1 py-3 rounded-lg border-2 flex flex-col items-center gap-1 transition-all ${
                            tokenColor === color
                              ? 'border-sand-700 shadow-md scale-105'
                              : 'border-sand-200 hover:border-sand-400'
                          }`}
                        >
                          <span className="w-6 h-6 rounded-full shadow" style={{ background: tc.bg }} />
                          <span className="text-xs font-semibold text-sand-700">{tc.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button
            onClick={() => onResolve(actionType, buyToken ? { buyMinorKnowledge: true, minorKnowledgeColor: tokenColor } : {})}
            className="w-full py-3 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim transition-colors"
          >
            Resolve Trade
          </button>
        </div>
        );
      })()}

      {/* ── MILITARY ── */}
      {actionType === 'MILITARY' && (() => {
        const canExploreTwice = cityId === 'thebes' && (developmentLevel ?? 0) >= 3;
        const troopsAfterGain = (playerTroopTrack ?? 0) + (playerMilitaryTrack ?? 0); // Can exceed 15 temporarily
        // Calculate remaining troops after first exploration
        const firstToken = (centralBoardTokens ?? []).find(t => t.id === exploreTokenId);
        const troopsAfterFirst = exploreTokenId && firstToken
          ? Math.max(0, troopsAfterGain - (firstToken.skullValue ?? 0))
          : troopsAfterGain;
        const exploreCount = (exploreTokenId ? 1 : 0) + (secondExploreTokenId ? 1 : 0);
        return (
          <div className="space-y-4">
            <div className="rounded-lg bg-terracotta/10 border border-terracotta/30 p-3">
              <p className="text-sm font-medium" style={{ color: '#b85c38' }}>
                Gain <span className="font-bold">{playerMilitaryTrack ?? 0}</span> troops from Military track
              </p>
              <p className="text-xs text-sand-500 mt-0.5">
                Troops: {playerTroopTrack ?? 0} → <span className="font-bold text-sand-800">{troopsAfterGain}</span>
                {troopsAfterGain > 15 && <span className="text-amber-600 ml-1">(capped to 15 after exploring)</span>}
              </p>
            </div>

            {centralBoardTokens && centralBoardTokens.length > 0 && (
              <>
                <div>
                  <p className="text-xs font-medium text-sand-600 mb-1">
                    {canExploreTwice ? 'Select token to explore (1st):' : 'Optionally explore a token:'}
                  </p>
                  <KnowledgeStore
                    tokens={centralBoardTokens}
                    selectedTokenId={exploreTokenId || undefined}
                    onSelectToken={(id) => {
                      if (id === exploreTokenId) {
                        setExploreTokenId('');
                        setSecondExploreTokenId('');
                      } else {
                        setExploreTokenId(id ?? '');
                        // Clear second if it's the same as new first
                        if (id === secondExploreTokenId) setSecondExploreTokenId('');
                      }
                    }}
                    availableTroops={troopsAfterGain}
                  />
                </div>

                {canExploreTwice && exploreTokenId && (
                  <div>
                    <p className="text-xs font-medium text-sand-600 mb-1">
                      Select token to explore (2nd) — <span className="text-purple-600">Thebes: Explore Twice</span>:
                    </p>
                    <KnowledgeStore
                      tokens={centralBoardTokens.filter(t => t.id !== exploreTokenId)}
                      selectedTokenId={secondExploreTokenId || undefined}
                      onSelectToken={(id) => {
                        setSecondExploreTokenId(id === secondExploreTokenId ? '' : (id ?? ''));
                      }}
                      availableTroops={troopsAfterFirst}
                    />
                  </div>
                )}
              </>
            )}

            {exploreCount > 0 && (
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                {exploreCount === 1 ? '1 token selected' : '2 tokens selected'} — will be explored when you resolve
              </div>
            )}

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                const choices: ActionChoices = {};
                if (exploreTokenId) choices.explorationTokenId = exploreTokenId;
                if (secondExploreTokenId) choices.secondExplorationTokenId = secondExploreTokenId;
                onResolve(actionType, choices);
              }}
              className="w-full py-3 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim transition-colors"
            >
              Resolve Military{exploreCount > 0 ? ` + Explore${exploreCount > 1 ? ' ×2' : ''}` : ''}
            </motion.button>
          </div>
        );
      })()}

      {/* ── LEGISLATION ── */}
      {actionType === 'LEGISLATION' && (
        <div className="space-y-4">
          <div className="rounded-lg bg-sky-50 border border-sky-200 p-3">
            <p className="text-sm text-sky-800 font-medium">Gain 3 citizens + draw 2 cards (keep 1)</p>
          </div>

          {legislationDraw && legislationDraw.length > 0 ? (
            <div>
              <p className="text-xs font-medium text-sand-600 mb-2">Choose a card to keep:</p>
              <div className="grid grid-cols-2 gap-3">
                {legislationDraw.map((card, i) => {
                  const typeColor = card.type === 'IMMEDIATE' ? 'bg-amber-100 text-amber-800' : card.type === 'ONGOING' ? 'bg-emerald-100 text-emerald-800' : 'bg-purple-100 text-purple-800';
                  return (
                    <motion.div
                      key={card.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="rounded-xl border-2 border-sand-200 bg-sand-50 p-4 hover:border-gold hover:shadow-md transition-all cursor-pointer"
                      onClick={() => onResolve(actionType, { targetCardId: card.id })}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="font-display text-sm font-bold text-sand-800">{card.name}</span>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase ${typeColor}`}>
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
                      <p className="text-[0.6rem] text-gold-dim font-medium mt-2 text-center">Tap to keep this card</p>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center">
              <p className="text-xs text-sand-400 mb-3">No cards in the deck to draw</p>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onResolve(actionType, {})}
                className="w-full py-3 rounded-lg font-semibold text-sm text-white shadow-md bg-sky-600 hover:bg-sky-700 transition-colors"
              >
                Resolve Legislation
              </motion.button>
            </div>
          )}
        </div>
      )}

      {/* ── SIMPLE ACTIONS (Philosophy, Culture, Development) ── */}
      {actionType !== 'POLITICS' && actionType !== 'TRADE' && actionType !== 'MILITARY' && actionType !== 'LEGISLATION' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-sand-200 p-4 text-center">
            <p className="text-sm text-sand-600">
              {actionType === 'PHILOSOPHY' && 'Gain 1 philosophy scroll'}
              {actionType === 'CULTURE' && 'Gain VP equal to your Culture track level'}
              {actionType === 'DEVELOPMENT' && 'Unlock your next city development'}
            </p>
          </div>

          {/* Development block reasons */}
          {actionType === 'DEVELOPMENT' && (() => {
            const devLevel = developmentLevel ?? 0;
            const devs = cityDevelopments ?? [];
            const nextDev = devs[devLevel];
            const isMiletusDev2 = nextDev?.id === 'miletus-dev-2' || (cityId === 'miletus' && devLevel === 1);
            if (devLevel >= 4) return <p className="text-xs text-red-500 text-center">All developments already unlocked</p>;
            if (!nextDev) return null;
            const cantAfford = coins < nextDev.drachmaCost;
            const cantMeetReq = !meetsReq(nextDev.knowledgeRequirement);
            const devShortfall = getKnowledgeShortfall(nextDev.knowledgeRequirement);
            const devScrollCost = devShortfall * 2;
            const canUseScrollsForDev = cantMeetReq && !cantAfford && canMeetWithScrolls(nextDev.knowledgeRequirement);

            if (cantAfford || (cantMeetReq && !canUseScrollsForDev && !useScrollsForDev)) {
              const reasons: string[] = [];
              if (cantAfford) reasons.push(`Need ${nextDev.drachmaCost} drachma (have ${coins})`);
              if (cantMeetReq) {
                const missing: string[] = [];
                if (tokenCounts.red < nextDev.knowledgeRequirement.red) missing.push(`${nextDev.knowledgeRequirement.red - tokenCounts.red} more red`);
                if (tokenCounts.blue < nextDev.knowledgeRequirement.blue) missing.push(`${nextDev.knowledgeRequirement.blue - tokenCounts.blue} more blue`);
                if (tokenCounts.green < nextDev.knowledgeRequirement.green) missing.push(`${nextDev.knowledgeRequirement.green - tokenCounts.green} more green`);
                reasons.push(`Need ${missing.join(', ')} token${missing.length > 1 ? 's' : ''}`);
              }
              return (
                <div className="space-y-2">
                  <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                    <p className="text-sm text-red-800 font-medium">Cannot develop: {nextDev.name}</p>
                    {reasons.map((r, i) => <p key={i} className="text-xs text-red-600 mt-0.5">⚠ {r}</p>)}
                  </div>
                </div>
              );
            }

            if (cantMeetReq && canUseScrollsForDev && !useScrollsForDev) {
              return (
                <div className="space-y-2">
                  <div className="rounded-lg bg-sand-100 border border-sand-200 p-3 text-xs text-sand-600">
                    Next: <span className="font-semibold text-sand-800">{nextDev.name}</span>
                    {nextDev.drachmaCost > 0 && ` — ${nextDev.drachmaCost}💰`}
                    {nextDev.knowledgeRequirement.red > 0 && ` ${nextDev.knowledgeRequirement.red}🔴`}
                    {nextDev.knowledgeRequirement.blue > 0 && ` ${nextDev.knowledgeRequirement.blue}🔵`}
                    {nextDev.knowledgeRequirement.green > 0 && ` ${nextDev.knowledgeRequirement.green}🟢`}
                  </div>
                  <div className="rounded bg-purple-50 border border-purple-200 p-2">
                    <p className="text-[0.65rem] text-purple-700">📜 Use {devScrollCost} scrolls to cover missing tokens?</p>
                    <button
                      onClick={() => setUseScrollsForDev(true)}
                      className="mt-1 px-3 py-1 bg-purple-600 text-white rounded text-[0.65rem] font-semibold hover:bg-purple-700 transition-colors"
                    >
                      Use Scrolls ({scrolls} available)
                    </button>
                  </div>
                </div>
              );
            }

            if (useScrollsForDev && cantMeetReq) {
              return (
                <div className="space-y-2">
                  <div className="rounded-lg bg-sand-100 border border-sand-200 p-3 text-xs text-sand-600">
                    Next: <span className="font-semibold text-sand-800">{nextDev.name}</span>
                    {nextDev.drachmaCost > 0 && ` — ${nextDev.drachmaCost}💰`}
                    {nextDev.knowledgeRequirement.red > 0 && ` ${nextDev.knowledgeRequirement.red}🔴`}
                    {nextDev.knowledgeRequirement.blue > 0 && ` ${nextDev.knowledgeRequirement.blue}🔵`}
                    {nextDev.knowledgeRequirement.green > 0 && ` ${nextDev.knowledgeRequirement.green}🟢`}
                  </div>
                  <div className="rounded bg-purple-50 border border-purple-200 p-2 flex items-center justify-between">
                    <span className="text-[0.65rem] text-purple-700 font-medium">📜 Using {devScrollCost} scrolls for knowledge</span>
                    <button
                      onClick={() => setUseScrollsForDev(false)}
                      className="text-[0.6rem] text-purple-500 hover:text-purple-700 underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div className="rounded-lg bg-sand-100 border border-sand-200 p-3 text-xs text-sand-600">
                Next: <span className="font-semibold text-sand-800">{nextDev.name}</span>
                {nextDev.drachmaCost > 0 && ` — ${nextDev.drachmaCost}💰`}
                {nextDev.knowledgeRequirement.red > 0 && ` ${nextDev.knowledgeRequirement.red}🔴`}
                {nextDev.knowledgeRequirement.blue > 0 && ` ${nextDev.knowledgeRequirement.blue}🔵`}
                {nextDev.knowledgeRequirement.green > 0 && ` ${nextDev.knowledgeRequirement.green}🟢`}
              </div>
            );
          })()}

          {/* Dev track selection (Miletus dev 2, Corinth dev 3) */}
          {actionType === 'DEVELOPMENT' && (() => {
            const devLevel = developmentLevel ?? 0;
            const devs = cityDevelopments ?? [];
            const nextDev = devs[devLevel];
            const needsTrackPick = nextDev?.id === 'miletus-dev-2' || (cityId === 'miletus' && devLevel === 1)
              || nextDev?.id === 'corinth-dev-3' || (cityId === 'corinth' && devLevel === 2);
            if (!needsTrackPick || devLevel >= 4) return null;
            const TRACKS: ProgressTrackType[] = ['ECONOMY', 'CULTURE', 'MILITARY'];
            const toggleTrack = (t: ProgressTrackType) => {
              setDevTrackChoices(prev => {
                if (prev.includes(t)) return prev.filter(x => x !== t);
                if (prev.length >= 2) return [prev[1], t];
                return [...prev, t];
              });
            };
            return (
              <div className="rounded-lg border border-sand-200 p-3">
                <p className="text-xs font-medium text-sand-600 mb-2">Choose 2 tracks to advance (free):</p>
                <div className="flex gap-2">
                  {TRACKS.map(t => {
                    const selected = devTrackChoices.includes(t);
                    return (
                      <button
                        key={t}
                        onClick={() => toggleTrack(t)}
                        className={`flex-1 py-2.5 rounded-lg border-2 text-xs font-semibold transition-all ${
                          selected
                            ? 'border-gold bg-gold/10 text-sand-800'
                            : 'border-sand-200 bg-sand-50 text-sand-500 hover:border-sand-400'
                        }`}
                      >
                        {t.charAt(0) + t.slice(1).toLowerCase()}
                        {selected && ' ✓'}
                      </button>
                    );
                  })}
                </div>
                {devTrackChoices.length === 2 && (
                  <p className="text-[0.65rem] text-emerald-600 mt-1.5">
                    +1 {devTrackChoices[0].charAt(0) + devTrackChoices[0].slice(1).toLowerCase()}, +1 {devTrackChoices[1].charAt(0) + devTrackChoices[1].slice(1).toLowerCase()}
                  </p>
                )}
              </div>
            );
          })()}

          {/* Argos dev 2: reward selection */}
          {actionType === 'DEVELOPMENT' && (() => {
            const devLevel = developmentLevel ?? 0;
            const devs = cityDevelopments ?? [];
            const nextDev = devs[devLevel];
            const isArgosDev2 = nextDev?.id === 'argos-dev-2' || (cityId === 'argos' && devLevel === 1);
            if (!isArgosDev2 || devLevel >= 4) return null;
            const REWARDS: { key: 'troops' | 'coins' | 'vp' | 'citizens'; label: string; icon: string }[] = [
              { key: 'troops', label: '+2 Troops', icon: '⚔️' },
              { key: 'coins', label: '+3 Drachma', icon: '💰' },
              { key: 'vp', label: '+4 VP', icon: '⭐' },
              { key: 'citizens', label: '+5 Citizens', icon: '👥' },
            ];
            return (
              <div className="rounded-lg border border-sand-200 p-3">
                <p className="text-xs font-medium text-sand-600 mb-2">Choose your reward:</p>
                <div className="grid grid-cols-2 gap-2">
                  {REWARDS.map(r => (
                    <button
                      key={r.key}
                      onClick={() => setArgosReward(r.key)}
                      className={`py-2.5 rounded-lg border-2 text-xs font-semibold transition-all ${
                        argosReward === r.key
                          ? 'border-gold bg-gold/10 text-sand-800'
                          : 'border-sand-200 bg-sand-50 text-sand-500 hover:border-sand-400'
                      }`}
                    >
                      {r.icon} {r.label}{argosReward === r.key ? ' ✓' : ''}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Sparta dev 3: explore up to 2 tokens */}
          {actionType === 'DEVELOPMENT' && (() => {
            const devLevel = developmentLevel ?? 0;
            const devs = cityDevelopments ?? [];
            const nextDev = devs[devLevel];
            const isSpartaDev3 = nextDev?.id === 'sparta-dev-3' || (cityId === 'sparta' && devLevel === 2);
            if (!isSpartaDev3 || devLevel >= 4) return null;
            const militaryTrack = playerMilitaryTrack ?? 0;
            const troopTrack = playerTroopTrack ?? 0;
            // After gaining troops from 2 military actions, available troops
            const troopsAfterGain = troopTrack + militaryTrack * 2; // Can exceed 15 temporarily
            const boardTokens = centralBoardTokens ?? [];
            if (boardTokens.length === 0) return null;
            const toggleSpartaToken = (tokenId: string) => {
              setSpartaExploreTokenIds(prev => {
                if (prev.includes(tokenId)) return prev.filter(id => id !== tokenId);
                if (prev.length >= 2) return [prev[1], tokenId];
                return [...prev, tokenId];
              });
            };
            // Calculate remaining troops after first exploration
            let troopsRemaining = troopsAfterGain;
            for (const tid of spartaExploreTokenIds) {
              const t = boardTokens.find(tok => tok.id === tid);
              if (t) troopsRemaining = Math.max(0, troopsRemaining - (t.skullValue ?? 0));
            }
            return (
              <div className="rounded-lg border border-sand-200 p-3">
                <p className="text-xs font-medium text-sand-600 mb-1">
                  You'll gain <span className="font-bold">{militaryTrack * 2}</span> troops. Optionally explore up to 2 tokens:
                </p>
                <p className="text-[0.65rem] text-sand-400 mb-2">
                  Troops after gain: {troopsAfterGain} | Selected: {spartaExploreTokenIds.length}/2
                </p>
                <KnowledgeStore
                  tokens={boardTokens}
                  selectedTokenId={spartaExploreTokenIds[spartaExploreTokenIds.length - 1] || undefined}
                  onSelectToken={(id) => id ? toggleSpartaToken(id) : setSpartaExploreTokenIds([])}
                  availableTroops={troopsRemaining}
                  compact
                />
                {spartaExploreTokenIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {spartaExploreTokenIds.map((tid, i) => {
                      const t = boardTokens.find(tok => tok.id === tid);
                      return t ? (
                        <span key={tid} className="text-[0.65rem] bg-emerald-50 border border-emerald-200 text-emerald-700 px-2 py-0.5 rounded-full">
                          Token {i + 1}: {t.color} ({t.militaryRequirement} req, -{t.skullValue ?? 0} troops)
                          <button onClick={() => setSpartaExploreTokenIds(prev => prev.filter(id => id !== tid))} className="ml-1 text-red-400 hover:text-red-600">×</button>
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Check if dev needs track selection before resolving */}
          {(() => {
            const devLevel = developmentLevel ?? 0;
            const devs = cityDevelopments ?? [];
            const nextDev = devs[devLevel];
            const needsTrackPick = actionType === 'DEVELOPMENT' && devLevel < 4 && (
              nextDev?.id === 'miletus-dev-2' || (cityId === 'miletus' && devLevel === 1)
              || nextDev?.id === 'corinth-dev-3' || (cityId === 'corinth' && devLevel === 2));
            const needsTrackSelection = needsTrackPick && devTrackChoices.length < 2;
            return needsTrackSelection ? (
              <p className="text-xs text-amber-600 text-center mb-1">Select 2 tracks above to resolve</p>
            ) : null;
          })()}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              if (actionType === 'DEVELOPMENT') {
                const devLevel = developmentLevel ?? 0;
                const devs = cityDevelopments ?? [];
                const nextDev = devs[devLevel];
                const needsTrackPick = nextDev?.id === 'miletus-dev-2' || (cityId === 'miletus' && devLevel === 1)
                  || nextDev?.id === 'corinth-dev-3' || (cityId === 'corinth' && devLevel === 2);
                const isArgosDev2 = nextDev?.id === 'argos-dev-2' || (cityId === 'argos' && devLevel === 1);
                const shortfall = nextDev ? getKnowledgeShortfall(nextDev.knowledgeRequirement) : 0;
                const isSpartaDev3 = nextDev?.id === 'sparta-dev-3' || (cityId === 'sparta' && devLevel === 2);
                // Block resolve if track selection not fully selected
                if (needsTrackPick && devTrackChoices.length < 2) return;
                const resolveChoices: ActionChoices = {};
                if (useScrollsForDev && shortfall > 0) resolveChoices.philosophyPairsToUse = shortfall;
                if (needsTrackPick && devTrackChoices.length === 2) resolveChoices.devTrackChoices = devTrackChoices;
                if (isArgosDev2) resolveChoices.argosDevReward = argosReward;
                if (isSpartaDev3 && spartaExploreTokenIds.length > 0) resolveChoices.spartaMilitaryTokenIds = spartaExploreTokenIds;
                onResolve(actionType, resolveChoices);
              } else {
                onResolve(actionType, {});
              }
            }}
            className={`w-full py-3 rounded-lg font-semibold text-sm text-white shadow-md transition-colors ${
              (() => {
                const devLevel = developmentLevel ?? 0;
                const devs = cityDevelopments ?? [];
                const nextDev = devs[devLevel];
                const needsTrackPick = actionType === 'DEVELOPMENT' && devLevel < 4 && (
                  nextDev?.id === 'miletus-dev-2' || (cityId === 'miletus' && devLevel === 1)
                  || nextDev?.id === 'corinth-dev-3' || (cityId === 'corinth' && devLevel === 2));
                return needsTrackPick && devTrackChoices.length < 2 ? 'opacity-50 cursor-not-allowed' : '';
              })()
            }`}
            style={{ background: info.color }}
          >
            Resolve {info.label}{actionType === 'DEVELOPMENT' && useScrollsForDev ? (() => {
              const devLevel = developmentLevel ?? 0;
              const devs = cityDevelopments ?? [];
              const nextDev = devs[devLevel];
              const shortfall = nextDev ? getKnowledgeShortfall(nextDev.knowledgeRequirement) : 0;
              return shortfall > 0 ? ` (−${shortfall * 2} 📜)` : '';
            })() : ''}
          </motion.button>
        </div>
      )}

      {/* Skip button — hidden for actions that cannot be skipped */}
      {!(['PHILOSOPHY', 'CULTURE', 'TRADE', 'MILITARY'] as ActionType[]).includes(actionType) && (
        <button
          onClick={onSkip}
          className="mt-3 w-full py-2 text-sand-500 text-xs font-medium hover:text-sand-700 transition-colors"
        >
          Skip this action
        </button>
      )}
    </motion.div>
  );
};
