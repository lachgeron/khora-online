import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClientMessage, LiveSolverResult, PublicGameState } from '../types';
import { useLiveSolverKeybind } from './useLiveSolverKeybind';

interface LiveSolverMode {
  enabled: boolean;
  toggle: () => void;
  requestNow: () => void;
  pending: boolean;
}

interface UseLiveSolverModeArgs {
  connected: boolean;
  currentPlayerId: string;
  gameState: PublicGameState | null;
  result: LiveSolverResult | null;
  sendMessage: (message: ClientMessage) => void;
}

export function useLiveSolverMode({
  connected,
  currentPlayerId,
  gameState,
  result,
  sendMessage,
}: UseLiveSolverModeArgs): LiveSolverMode {
  const [enabled, setEnabled] = useState(false);
  const [lastRequestId, setLastRequestId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPositionKeyRef = useRef<string | null>(null);

  const toggle = useCallback(() => setEnabled(v => !v), []);
  useLiveSolverKeybind(toggle);

  const requestNow = useCallback(() => {
    if (!connected || !gameState || !currentPlayerId) return;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setLastRequestId(requestId);
    sendMessage({
      type: 'LIVE_SOLVER_REQUEST',
      requestId,
      options: {
        timeBudgetMs: 3600,
        beamWidth: 72,
        targetBranches: 18,
        opponentBranches: 1,
        completionWidth: 18,
        maxDecisionPlies: 900,
        exactTimeBudgetMs: 6500,
        exactNodeLimit: 250000,
      },
    });
  }, [connected, currentPlayerId, gameState, sendMessage]);

  const positionKey = useMemo(() => {
    if (!gameState) return '';
    return JSON.stringify({
      round: gameState.roundNumber,
      phase: gameState.currentPhase,
      pending: gameState.pendingDecisions.map(d => `${d.playerId}:${d.decisionType}:${d.timeoutAt}:${d.usingTimeBank ? 1 : 0}`),
      players: gameState.players.map(p => ({
        id: p.playerId,
        vp: p.victoryPoints,
        coins: p.coins,
        scrolls: p.philosophyTokens,
        tracks: [p.economyTrack, p.cultureTrack, p.militaryTrack, p.taxTrack, p.gloryTrack, p.troopTrack, p.citizenTrack],
        hand: p.handCardCount,
        played: p.playedCardCount,
        tokens: p.knowledgeTokens.map(t => t.id).join(','),
        slots: p.actionSlots.map(s => `${s.actionType}:${s.resolved ? 1 : 0}`).join(','),
        flagged: p.hasFlagged,
      })),
      event: gameState.currentEvent?.id ?? null,
      achievements: gameState.availableAchievements.map(a => a.id),
      board: gameState.centralBoardTokens.filter(t => !t.explored).map(t => t.id),
    });
  }, [gameState]);

  useEffect(() => {
    if (!enabled || !connected || !gameState || !currentPlayerId) return;
    if (positionKey === lastPositionKeyRef.current) return;
    lastPositionKeyRef.current = positionKey;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      requestNow();
    }, 180);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [connected, currentPlayerId, enabled, gameState, positionKey, requestNow]);

  const pending = enabled && lastRequestId !== null && result?.requestId !== lastRequestId;
  return { enabled, toggle, requestNow, pending };
}
