import React, { useEffect, useState } from 'react';
import { listGames } from '../api';

export interface GameListingItem {
  id: string;
  type: 'lobby' | 'game';
  hostName: string;
  players: { name: string; connected: boolean }[];
  maxPlayers: number;
  openSeats: number;
  currentPhase?: string;
  roundNumber?: number;
}

export interface GameBrowserProps {
  playerName: string;
  onCreateGame: () => void;
  onJoinLobby: (lobbyId: string) => void;
  error: string | null;
}

export const GameBrowser: React.FC<GameBrowserProps> = ({
  playerName, onCreateGame, onJoinLobby, error,
}) => {
  const [listings, setListings] = useState<GameListingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const data = await listGames();
        if (active) setListings(data);
      } catch { /* ignore */ }
      if (active) setLoading(false);
    };

    poll();
    const id = setInterval(poll, 3000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const lobbies = listings.filter(g => g.type === 'lobby');
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sand-500 text-xs">Playing as</p>
          <p className="font-semibold text-sand-800 text-sm">{playerName}</p>
        </div>
        <button
          onClick={onCreateGame}
          className="px-5 py-2.5 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim transition-colors"
        >
          Create Game
        </button>
      </div>

      {error && <p className="text-crimson text-xs">{error}</p>}

      {loading && <p className="text-sand-500 text-sm text-center py-4">Loading games...</p>}

      {!loading && listings.length === 0 && (
        <div className="text-center py-8">
          <p className="text-sand-500 text-sm">No games available right now.</p>
          <p className="text-sand-400 text-xs mt-1">Create one to get started.</p>
        </div>
      )}

      {lobbies.length > 0 && (
        <div>
          <p className="font-display text-xs uppercase tracking-[0.12em] text-sand-500 mb-2">Open Lobbies</p>
          <div className="space-y-2">
            {lobbies.map(g => (
              <div key={g.id} className="flex items-center justify-between px-4 py-3 bg-sand-100 border border-sand-300 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-sand-800 truncate">{g.hostName}'s game</p>
                  <p className="text-xs text-sand-500">{g.players.length}/{g.maxPlayers} players</p>
                </div>
                <button
                  onClick={() => onJoinLobby(g.id)}
                  className="ml-3 px-4 py-1.5 bg-sand-300 text-sand-800 rounded-lg font-semibold text-xs hover:bg-sand-400 transition-colors"
                >
                  Join
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
};
