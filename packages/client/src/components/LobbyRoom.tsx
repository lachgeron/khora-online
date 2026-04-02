import React from 'react';
import type { PlayerInfo } from '../types';

export interface LobbyRoomProps {
  players: PlayerInfo[];
  currentPlayerId: string;
  hostPlayerId: string;
  onStartGame: () => void;
  onBack: () => void;
}

export const LobbyRoom: React.FC<LobbyRoomProps> = ({
  players, currentPlayerId, hostPlayerId, onStartGame, onBack,
}) => {
  const isHost = currentPlayerId === hostPlayerId;

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="max-w-md w-full text-center px-6">
        <h1 className="font-display text-2xl font-bold text-sand-800 mb-6">Game Lobby</h1>

        <div className="space-y-2 mb-6">
          {players.map((p, i) => (
            <div key={p.playerId} className="flex items-center gap-3 px-4 py-2.5 bg-sand-100 border border-sand-300 rounded-lg">
              <span className="w-7 h-7 flex items-center justify-center bg-sand-700 text-sand-100 rounded-full text-xs font-bold">{i + 1}</span>
              <span className="font-medium text-sm text-sand-800 flex-1 text-left">{p.playerName}</span>
              {p.playerId === hostPlayerId && (
                <span className="text-[0.6rem] uppercase tracking-wide text-gold font-bold">Host</span>
              )}
              {p.playerId === currentPlayerId && (
                <span className="text-[0.6rem] uppercase tracking-wide text-olive font-bold">You</span>
              )}
            </div>
          ))}
        </div>

        {isHost && (
          <button
            onClick={onStartGame}
            disabled={players.length < 2}
            className="w-full px-4 py-3 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Start Game ({players.length}/4 players)
          </button>
        )}
        {!isHost && (
          <p className="text-sand-500 text-sm">Waiting for host to start the game...</p>
        )}

        <button
          onClick={onBack}
          className="mt-4 text-sand-500 text-xs hover:text-sand-700 transition-colors"
        >
          ← Back to game list
        </button>
      </div>
    </div>
  );
};
