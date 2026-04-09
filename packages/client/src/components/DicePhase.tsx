import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import type { ActionType, ActionSlot, DiceAssignment, PublicPlayerState } from '../types';
import { CountdownTimer } from './CountdownTimer';

const ACTIONS: { type: ActionType; number: number; label: string; icon: string }[] = [
  { type: 'PHILOSOPHY', number: 0, label: 'Philosophy', icon: '📜' },
  { type: 'LEGISLATION', number: 1, label: 'Legislation', icon: '📋' },
  { type: 'CULTURE', number: 2, label: 'Culture', icon: '🎭' },
  { type: 'TRADE', number: 3, label: 'Trade', icon: '💰' },
  { type: 'MILITARY', number: 4, label: 'Military', icon: '⚔️' },
  { type: 'POLITICS', number: 5, label: 'Politics', icon: '🏛' },
  { type: 'DEVELOPMENT', number: 6, label: 'Development', icon: '🔨' },
];

export interface DicePhaseProps {
  diceRoll: number[] | null;
  citizenTrack: number;
  philosophyTokens: number;
  players: PublicPlayerState[];
  currentPlayerId: string;
  startPlayerId: string;
  actionSlots: [ActionSlot | null, ActionSlot | null, ActionSlot | null];
  pendingDecisions: { playerId: string; decisionType: string; timeoutAt: number; usingTimeBank?: boolean }[];
  onRoll: () => void;
  onAssign: (assignments: DiceAssignment[], philosophyTokensToSpend?: number) => void;
  onUnassign: () => void;
}

const Die: React.FC<{ value: number; size?: 'lg' | 'sm' }> = ({ value, size = 'lg' }) => (
  <motion.span
    initial={{ scale: 0, rotate: -180 }}
    animate={{ scale: 1, rotate: 0 }}
    transition={{ type: 'spring', stiffness: 300, damping: 20 }}
    className={`inline-flex items-center justify-center bg-sand-800 text-sand-100 rounded-lg font-bold shadow-md ${
      size === 'lg' ? 'w-12 h-12 text-xl' : 'w-8 h-8 text-sm'
    }`}
  >
    {value}
  </motion.span>
);

const PlayerRoll: React.FC<{ p: PublicPlayerState; isMe: boolean; isStar: boolean }> = ({ p, isMe, isStar }) => (
  <div className="flex items-center gap-2 py-1">
    <span className={`text-xs font-medium ${isMe ? 'text-sand-800 font-bold' : 'text-sand-600'}`}>
      {p.playerName}{isMe ? ' (you)' : ''}{isStar ? ' ★' : ''}
    </span>
    <span className="ml-auto flex gap-1">
      {p.diceRoll ? p.diceRoll.map((d, i) => (
        <span key={i} className="w-6 h-6 rounded bg-sand-700 text-sand-100 text-[0.65rem] font-bold flex items-center justify-center">{d}</span>
      )) : <span className="text-xs text-sand-400 italic">rolling...</span>}
    </span>
    {p.diceRoll && (
      <span className="text-[0.65rem] text-sand-400 w-6 text-right">{p.diceRoll.reduce((a, b) => a + b, 0)}</span>
    )}
  </div>
);

export const DicePhase: React.FC<DicePhaseProps> = ({
  diceRoll, citizenTrack, philosophyTokens, players, currentPlayerId, startPlayerId,
  actionSlots, pendingDecisions, onRoll, onAssign, onUnassign,
}) => {
  const hasRolled = diceRoll !== null;
  const allRolled = players.every(p => !p.isConnected || (p.diceRoll != null && p.diceRoll.length > 0));
  const [slots, setSlots] = useState<(ActionType | null)[]>([null, null, null]);
  const [scrollsToSpend, setScrollsToSpend] = useState(0);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const hasPending = pendingDecisions.some(d => d.playerId === currentPlayerId);
  const hasAssigned = actionSlots.some(s => s !== null);
  const isLockedIn = hasAssigned && !hasPending;

  const getCost = (die: number, action: ActionType) => Math.max(0, (ACTIONS.find(a => a.type === action)?.number ?? 0) - die);

  const handleDragStart = useCallback((e: React.DragEvent, actionType: ActionType, fromSlot?: number) => {
    e.dataTransfer.setData('text/plain', actionType);
    if (fromSlot !== undefined) e.dataTransfer.setData('fromSlot', String(fromSlot));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, slotIndex: number) => {
    e.preventDefault();
    setDragOver(null);
    const actionType = e.dataTransfer.getData('text/plain') as ActionType;
    if (!actionType) return;
    setSlots(prev => {
      const next = [...prev];
      // Remove this action from any other slot
      for (let i = 0; i < next.length; i++) {
        if (next[i] === actionType) next[i] = null;
      }
      next[slotIndex] = actionType;
      return next;
    });
  }, []);

  const handleSlotDragEnd = useCallback((e: React.DragEvent, slotIndex: number) => {
    // If the drop wasn't accepted by a valid target, reset the slot
    if (e.dataTransfer.dropEffect === 'none') {
      setSlots(prev => { const next = [...prev]; next[slotIndex] = null; return next; });
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, slotIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(slotIndex);
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(null), []);

  const removeFromSlot = (slotIndex: number) => {
    setSlots(prev => { const next = [...prev]; next[slotIndex] = null; return next; });
  };

  // Keep a ref to current slots so the timeout callback sees latest state
  const slotsRef = useRef(slots);
  slotsRef.current = slots;

  // Track whether we've already auto-submitted to prevent double-firing
  const autoSubmittedRef = useRef(false);

  // Reset auto-submitted flag when pending decisions change (e.g., after unassign)
  const assignDecision = pendingDecisions.find(d => d.playerId === currentPlayerId && d.decisionType === 'ASSIGN_DICE');
  useEffect(() => {
    if (assignDecision) {
      autoSubmittedRef.current = false;
    }
  }, [assignDecision?.timeoutAt]);

  const handleAssignExpire = useCallback(() => {
    if (autoSubmittedRef.current) return;
    if (!diceRoll || diceRoll.length === 0) return;
    autoSubmittedRef.current = true;

    const currentSlots = [...slotsRef.current];
    const diceCount = diceRoll.length;
    const sortedActions = [...ACTIONS].sort((a, b) => a.number - b.number);

    // Fill empty slots with cheapest available actions
    for (let i = 0; i < diceCount; i++) {
      if (!currentSlots[i]) {
        const usedActions = new Set(currentSlots.slice(0, diceCount).filter((s): s is ActionType => s !== null));
        const cheapest = sortedActions.find(a => !usedActions.has(a.type));
        if (cheapest) currentSlots[i] = cheapest.type;
      }
    }

    const assignments: DiceAssignment[] = [];
    for (let i = 0; i < diceCount; i++) {
      if (currentSlots[i]) {
        assignments.push({ slotIndex: i as 0 | 1 | 2, actionType: currentSlots[i]!, dieValue: diceRoll[i] });
      }
    }
    if (assignments.length === diceCount) {
      onAssign(assignments);
    }
  }, [diceRoll, onAssign]);

  // Fire auto-submit 3 seconds BEFORE server timeout to win the race.
  // The server auto-resolves at timeoutAt and would ignore partial assignments,
  // so we submit the client's current state early to preserve player choices.
  // Only do this when already using time bank — if on normal timer, let the
  // server handle the timeout so it can transition to time bank first.
  useEffect(() => {
    if (!assignDecision || !diceRoll || diceRoll.length === 0) return;
    if (!assignDecision.usingTimeBank) return; // let server transition to time bank
    const earlyMs = assignDecision.timeoutAt - Date.now() - 3000;
    if (earlyMs <= 0) {
      // Already past the early-submit window — fire immediately
      handleAssignExpire();
      return;
    }
    const timer = setTimeout(handleAssignExpire, earlyMs);
    return () => clearTimeout(timer);
  }, [assignDecision?.timeoutAt, assignDecision?.usingTimeBank, diceRoll, handleAssignExpire]);

  // ── ROLL STEP ──
  if (!hasRolled) {
    const rollDecision = pendingDecisions.find(d => d.playerId === currentPlayerId && d.decisionType === 'ROLL_DICE');
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
        <h3 className="font-display text-lg font-bold text-sand-800 mb-2">🎲 Dice Phase</h3>
        {rollDecision && (
          <div className="flex justify-center mb-3">
            <CountdownTimer timeoutAt={rollDecision.timeoutAt} usingTimeBank={rollDecision.usingTimeBank} />
          </div>
        )}
        {players.some(p => p.playerId !== currentPlayerId && p.diceRoll != null) && (
          <div className="mb-4 rounded-lg bg-sand-100 p-3">
            {players.filter(p => p.diceRoll != null).map(p => (
              <PlayerRoll key={p.playerId} p={p} isMe={p.playerId === currentPlayerId} isStar={p.playerId === startPlayerId} />
            ))}
          </div>
        )}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={onRoll}
          className="px-8 py-4 bg-sand-800 text-sand-100 rounded-xl font-display font-bold text-lg shadow-lg hover:bg-sand-700 transition-colors"
        >
          Roll Dice
        </motion.button>
      </motion.div>
    );
  }

  // ── WAITING FOR OTHERS TO ROLL ──
  if (!allRolled) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h3 className="font-display text-lg font-bold text-sand-800 mb-2">🎲 Dice Phase</h3>
        <div className="flex justify-center gap-3 mb-4">
          {diceRoll.map((d, i) => <Die key={i} value={d} />)}
        </div>
        <div className="rounded-lg bg-sand-100 p-3 mb-3">
          {players.map(p => (
            <PlayerRoll key={p.playerId} p={p} isMe={p.playerId === currentPlayerId} isStar={p.playerId === startPlayerId} />
          ))}
        </div>
        <p className="text-sm text-sand-500 text-center">Waiting for others to roll...</p>
      </motion.div>
    );
  }

  // ── LOCKED IN ──
  if (isLockedIn && diceRoll) {
    const assignPending = pendingDecisions.filter(d => d.decisionType === 'ASSIGN_DICE');
    const waitingPlayers = players.filter(p => assignPending.some(d => d.playerId === p.playerId));
    const timeoutAt = assignPending[0]?.timeoutAt ?? 0;
    const tbFlag = assignPending[0]?.usingTimeBank;
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h3 className="font-display text-lg font-bold text-sand-800 mb-3">🎲 Actions Locked In</h3>
        <div className="space-y-2 mb-4">
          {actionSlots.map((slot, i) => slot ? (
            <div key={i} className="flex items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2">
              <Die value={slot.assignedDie} size="sm" />
              <span className="text-sm font-semibold text-sand-800">→</span>
              <span className="text-sm">{ACTIONS.find(a => a.type === slot.actionType)?.icon} {ACTIONS.find(a => a.type === slot.actionType)?.label}</span>
              {slot.citizenCost > 0 && <span className="ml-auto text-xs text-sand-500">-{slot.citizenCost} 👤</span>}
            </div>
          ) : null)}
        </div>
        {waitingPlayers.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 mb-3">
            <CountdownTimer timeoutAt={timeoutAt} usingTimeBank={tbFlag} />
            <p className="text-xs text-sand-600 mt-2 font-medium">Waiting for:</p>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {waitingPlayers.map(p => (
                <span key={p.playerId} className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[0.65rem] font-semibold">
                  {p.playerName}
                </span>
              ))}
            </div>
          </div>
        )}
        <button
          onClick={() => { setSlots([null, null, null]); onUnassign(); }}
          className="w-full py-2 text-sand-500 text-xs font-medium border border-sand-300 rounded-lg hover:bg-sand-100 transition-colors"
        >
          Change Selection
        </button>
      </motion.div>
    );
  }

  // ── ASSIGN ACTIONS (drag & drop) ──
  const diceCount = diceRoll.length;
  const usedActions = new Set(slots.slice(0, diceCount).filter((s): s is ActionType => s !== null));
  const totalCost = slots.slice(0, diceCount).reduce((sum, s, i) => sum + (s ? getCost(diceRoll[i], s) : 0), 0);
  const bonusCitizens = scrollsToSpend * 3;
  const effectiveCitizens = citizenTrack + bonusCitizens;
  const canAfford = totalCost <= effectiveCitizens;
  const allSelected = slots.slice(0, diceCount).every(s => s !== null);
  const canSubmit = allSelected && canAfford;

  const handleSubmit = () => {
    const assignments: DiceAssignment[] = [];
    for (let i = 0; i < diceCount; i++) {
      if (slots[i]) assignments.push({ slotIndex: i as 0 | 1 | 2, actionType: slots[i]!, dieValue: diceRoll[i] });
    }
    onAssign(assignments, scrollsToSpend > 0 ? scrollsToSpend : undefined);
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <h3 className="font-display text-lg font-bold text-sand-800 mb-1">🎲 Assign Actions</h3>

      {/* Countdown */}
      {pendingDecisions.filter(d => d.decisionType === 'ASSIGN_DICE').length > 0 && (
        <div className="mb-3">
          <CountdownTimer timeoutAt={pendingDecisions.find(d => d.decisionType === 'ASSIGN_DICE')!.timeoutAt} usingTimeBank={pendingDecisions.find(d => d.decisionType === 'ASSIGN_DICE')?.usingTimeBank} />
        </div>
      )}

      {/* Player rolls */}
      <div className="rounded-lg bg-sand-100 p-2 mb-4">
        {players.map(p => (
          <PlayerRoll key={p.playerId} p={p} isMe={p.playerId === currentPlayerId} isStar={p.playerId === startPlayerId} />
        ))}
      </div>

      {/* Resources */}
      <div className="flex gap-3 mb-3 text-xs text-sand-600">
        <span>👤 Citizens: <span className="font-bold text-sand-800">{citizenTrack}{bonusCitizens > 0 ? ` + ${bonusCitizens}` : ''}</span></span>
        <span>📜 Scrolls: <span className="font-bold text-sand-800">{philosophyTokens - scrollsToSpend}</span></span>
        {totalCost > 0 && (
          <span className={canAfford ? 'text-amber-700' : 'text-red-600 font-bold'}>
            Cost: {totalCost} 👤
          </span>
        )}
      </div>

      {/* Scroll spending */}
      {philosophyTokens > 0 && (
        <div className="flex items-center gap-2 mb-4 rounded-lg bg-purple-50 border border-purple-200 px-3 py-2">
          <span className="text-xs text-purple-700">📜 Spend scrolls for citizens (1 → 3👤):</span>
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={() => setScrollsToSpend(Math.max(0, scrollsToSpend - 1))} disabled={scrollsToSpend === 0}
              className="w-6 h-6 rounded bg-purple-200 text-purple-800 text-sm font-bold disabled:opacity-30 hover:bg-purple-300 transition-colors">−</button>
            <span className="w-6 text-center text-sm font-bold text-purple-800">{scrollsToSpend}</span>
            <button onClick={() => setScrollsToSpend(Math.min(philosophyTokens, scrollsToSpend + 1))} disabled={scrollsToSpend >= philosophyTokens}
              className="w-6 h-6 rounded bg-purple-200 text-purple-800 text-sm font-bold disabled:opacity-30 hover:bg-purple-300 transition-colors">+</button>
          </div>
        </div>
      )}

      {/* Action tiles (draggable) */}
      <p className="text-[0.65rem] font-display uppercase tracking-[0.12em] text-sand-500 mb-2 text-center">Drag actions to dice</p>
      <div className="flex flex-wrap gap-2 mb-5 justify-center">
        {ACTIONS.map(a => {
          const isUsed = usedActions.has(a.type);
          return (
            <div
              key={a.type}
              draggable={!isUsed}
              onDragStart={(e) => handleDragStart(e, a.type)}
              className={`flex flex-col items-center gap-1 w-[4.5rem] py-2.5 rounded-lg border-2 text-center select-none transition-all ${
                isUsed
                  ? 'border-sand-200 bg-sand-100 opacity-30 cursor-default'
                  : 'border-sand-300 bg-sand-50 cursor-grab active:cursor-grabbing hover:border-sand-500 hover:shadow-sm'
              }`}
            >
              <span className="text-xl leading-none">{a.icon}</span>
              <span className="text-[0.6rem] font-semibold text-sand-700 leading-tight">{a.label}</span>
              <span className="text-[0.5rem] text-sand-400">#{a.number}</span>
            </div>
          );
        })}
      </div>

      {/* Dice drop zones */}
      <div className="flex gap-4 justify-center mb-5">
        {diceRoll.slice(0, diceCount).map((dieValue, i) => {
          const assigned = slots[i];
          const action = assigned ? ACTIONS.find(a => a.type === assigned) : null;
          const cost = assigned ? getCost(dieValue, assigned) : 0;
          const isOver = dragOver === i;

          return (
            <div
              key={i}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, i)}
              className={`relative flex flex-col items-center rounded-xl border-2 border-dashed transition-all ${
                assigned
                  ? 'border-gold bg-gold/5 w-28'
                  : isOver
                  ? 'border-gold bg-gold/10 w-28 scale-105'
                  : 'border-sand-300 bg-sand-50 w-28'
              }`}
            >
              {/* Die value header */}
              <div className="flex items-center justify-center w-full py-2 rounded-t-lg bg-sand-800">
                <span className="text-xl font-bold text-sand-100">{dieValue}</span>
              </div>

              {/* Drop zone / assigned action */}
              <div className="flex flex-col items-center justify-center py-3 px-2 min-h-[5rem]">
                {assigned && action ? (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    draggable
                    onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, assigned, i)}
                    onDragEnd={(e) => handleSlotDragEnd(e as unknown as React.DragEvent, i)}
                    className="flex flex-col items-center gap-1 cursor-grab active:cursor-grabbing"
                    onClick={() => removeFromSlot(i)}
                    title="Drag to move or click to remove"
                  >
                    <span className="text-2xl">{action.icon}</span>
                    <span className="text-xs font-semibold text-sand-800">{action.label}</span>
                    {cost > 0 ? (
                      <span className="text-[0.65rem] font-bold text-amber-700">-{cost} 👤</span>
                    ) : (
                      <span className="text-[0.65rem] text-emerald-600 font-medium">Free</span>
                    )}
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center gap-1 text-sand-400">
                    <span className="text-2xl">↓</span>
                    <span className="text-[0.6rem]">Drop here</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Submit */}
      <motion.button
        whileHover={canSubmit ? { scale: 1.02 } : {}}
        whileTap={canSubmit ? { scale: 0.98 } : {}}
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full py-3 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Lock In Actions
      </motion.button>
    </motion.div>
  );
};
