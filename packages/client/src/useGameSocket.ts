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
}

export function useGameSocket(gameId: string | null, playerId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<GameSocketState>({
    gameState: null,
    privateState: null,
    finalScores: null,
    error: null,
    connected: false,
    adminDeckCards: null,
    adminEventCards: null,
  });

  useEffect(() => {
    if (!gameId || !playerId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsHost = import.meta.env.VITE_WS_HOST || window.location.host;
    const url = `${protocol}//${wsHost}/ws?gameId=${gameId}&playerId=${playerId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
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
        setState((s) => ({ ...s, adminEventCards: msg.eventCards }));
      } else if (msg.type === 'ERROR') {
        setState((s) => ({ ...s, error: msg.message }));
      }
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
    };

    ws.onerror = () => {
      setState((s) => ({ ...s, error: 'WebSocket connection error' }));
    };

    // Heartbeat every 15 seconds
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
      }
    }, 15_000);

    return () => {
      clearInterval(heartbeat);
      ws.close();
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
