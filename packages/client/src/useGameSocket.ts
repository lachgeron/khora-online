/**
 * WebSocket hook for real-time game communication.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import type { ClientMessage, ServerMessage, PublicGameState, PrivatePlayerState, FinalScoreBoard, PoliticsCard, EventCard } from './types';

export interface GameSocketState {
  gameState: PublicGameState | null;
  privateState: PrivatePlayerState | null;
  finalScores: FinalScoreBoard | null;
  error: string | null;
  connected: boolean;
  adminDeckCards: PoliticsCard[] | null;
  adminEventCards: EventCard[] | null;
  adminUnusedEvents: EventCard[] | null;
}

export function useGameSocket(gameId: string | null, playerId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalCloseRef = useRef(false);
  const [state, setState] = useState<GameSocketState>({
    gameState: null,
    privateState: null,
    finalScores: null,
    error: null,
    connected: false,
    adminDeckCards: null,
    adminEventCards: null,
    adminUnusedEvents: null,
  });

  useEffect(() => {
    if (!gameId || !playerId) return;

    intentionalCloseRef.current = false;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = import.meta.env.VITE_WS_HOST || window.location.host;
    const url = `${protocol}//${wsHost}/ws?gameId=${gameId}&playerId=${playerId}`;

    let heartbeat: ReturnType<typeof setInterval> | null = null;

    function connect() {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        setState((s) => ({ ...s, connected: true, error: null }));
      };

      ws.onmessage = (event) => {
        const msg: ServerMessage = JSON.parse(event.data);
        if (msg.type === 'GAME_STATE_UPDATE') {
          setState((s) => ({
            ...s,
            gameState: msg.state,
            privateState: msg.privateState,
            // Also pick up finalScores from the public state if present
            finalScores: msg.state.finalScores ?? s.finalScores,
          }));
        } else if (msg.type === 'GAME_OVER') {
          setState((s) => ({
            ...s,
            finalScores: msg.finalScores,
          }));
        } else if (msg.type === 'ADMIN_DECK_RESPONSE') {
          setState((s) => ({ ...s, adminDeckCards: msg.deckCards }));
        } else if (msg.type === 'ADMIN_EVENTS_RESPONSE') {
          setState((s) => ({ ...s, adminEventCards: msg.eventCards, adminUnusedEvents: msg.unusedEvents }));
        } else if (msg.type === 'ERROR') {
          setState((s) => ({ ...s, error: msg.message }));
        }
      };

      ws.onclose = () => {
        setState((s) => ({ ...s, connected: false }));
        wsRef.current = null;

        // Auto-reconnect with exponential backoff (max 30s), unless intentionally closed
        if (!intentionalCloseRef.current) {
          const attempt = reconnectAttemptRef.current;
          const delay = Math.min(1000 * Math.pow(2, attempt), 30_000);
          reconnectAttemptRef.current = attempt + 1;
          console.log(`[WS] Connection lost. Reconnecting in ${delay}ms (attempt ${attempt + 1})...`);
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror, which handles reconnection
      };
    }

    connect();

    // Heartbeat every 15 seconds
    heartbeat = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'HEARTBEAT' }));
      }
    }, 15_000);

    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (heartbeat) clearInterval(heartbeat);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [gameId, playerId]);

  const sendMessage = useCallback((message: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return { ...state, sendMessage };
}
