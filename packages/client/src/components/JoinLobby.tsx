import React, { useState } from 'react';

export interface JoinLobbyProps {
  onJoinLobby: (code: string, name: string) => void;
  error: string | null;
}

export const JoinLobby: React.FC<JoinLobbyProps> = ({ onJoinLobby, error }) => {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-sand-800">Join Game</h2>
      <input
        type="text"
        placeholder="Invite code"
        value={code}
        onChange={e => setCode(e.target.value.toUpperCase())}
        className="w-full px-4 py-2.5 bg-sand-50 border border-sand-300 rounded-lg text-sm font-mono tracking-widest focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
      />
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={e => setName(e.target.value)}
        className="w-full px-4 py-2.5 bg-sand-50 border border-sand-300 rounded-lg text-sm focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
      />
      <button
        onClick={() => code.trim() && name.trim() && onJoinLobby(code.trim(), name.trim())}
        disabled={!code.trim() || !name.trim()}
        className="w-full px-4 py-2.5 bg-sand-300 text-sand-800 rounded-lg font-semibold text-sm hover:bg-sand-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Join Lobby
      </button>
      {error && <p className="text-crimson text-xs">{error}</p>}
    </div>
  );
};
