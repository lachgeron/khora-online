/**
 * Polls the server for lobby updates every `intervalMs` milliseconds.
 * Detects player list changes and game start events.
 */

import { useEffect, useRef } from 'react';
import type { PlayerInfo } from './types';

export interface LobbyPollResult {
  players: PlayerInfo[];
  started: boolean;
  gameId: string | null;
}

export function useLobbyPolling(
  lobbyId: string | null,
  intervalMs: number,
  onUpdate: (result: LobbyPollResult) => void,
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!lobbyId) return;

    let active = true;

    const poll = async () => {
      try {
        const res = await fetch(`/api/lobbies/${lobbyId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (active) {
          onUpdateRef.current({
            players: data.players ?? [],
            started: data.started ?? false,
            gameId: data.gameId ?? null,
          });
        }
      } catch {
        // ignore fetch errors during polling
      }
    };

    poll();
    const id = setInterval(poll, intervalMs);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [lobbyId, intervalMs]);
}
