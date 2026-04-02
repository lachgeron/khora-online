import React, { useState } from 'react';

export interface CreateLobbyProps {
  onCreateLobby: (name: string) => void;
}

export const CreateLobby: React.FC<CreateLobbyProps> = ({ onCreateLobby }) => {
  const [name, setName] = useState('');

  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-sand-800">Create Game</h2>
      <input
        type="text"
        placeholder="Your name"
        value={name}
        onChange={e => setName(e.target.value)}
        className="w-full px-4 py-2.5 bg-sand-50 border border-sand-300 rounded-lg text-sm focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
      />
      <button
        onClick={() => name.trim() && onCreateLobby(name.trim())}
        disabled={!name.trim()}
        className="w-full px-4 py-2.5 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Create Lobby
      </button>
    </div>
  );
};
