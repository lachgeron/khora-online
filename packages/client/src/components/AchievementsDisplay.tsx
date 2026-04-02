import React from 'react';
import type { AchievementToken, PublicPlayerState } from '../types';

interface AchievementsDisplayProps {
  available: AchievementToken[];
  claimed: Record<string, AchievementToken[]>;
  players: PublicPlayerState[];
}

const PLAYER_COLORS = ['#e06030', '#3080d0', '#40a050', '#9060b0'];

/** All 5 achievements with their status — available, or claimed by whom. */
export const AchievementsDisplay: React.FC<AchievementsDisplayProps> = ({ available, claimed, players }) => {
  // Build a map: achievementId → list of player names who claimed it
  const claimedBy = new Map<string, { name: string; color: string }[]>();
  for (const [playerId, tokens] of Object.entries(claimed ?? {})) {
    const pIdx = players.findIndex(p => p.playerId === playerId);
    const pName = players.find(p => p.playerId === playerId)?.playerName ?? playerId;
    const pColor = PLAYER_COLORS[pIdx % PLAYER_COLORS.length];
    for (const token of tokens) {
      const existing = claimedBy.get(token.id) ?? [];
      existing.push({ name: pName, color: pColor });
      claimedBy.set(token.id, existing);
    }
  }

  // Combine available + claimed into a full list
  const allAchievements: { token: AchievementToken; claimers: { name: string; color: string }[] }[] = [];

  // Add available ones first
  for (const a of available) {
    allAchievements.push({ token: a, claimers: [] });
  }

  // Add claimed ones
  for (const [, tokens] of Object.entries(claimed ?? {})) {
    for (const token of tokens) {
      if (!allAchievements.some(a => a.token.id === token.id)) {
        allAchievements.push({ token, claimers: claimedBy.get(token.id) ?? [] });
      }
    }
  }

  return (
    <div>
      <p className="font-display text-[0.65rem] uppercase tracking-[0.12em] text-sand-600 mb-2">Achievements</p>
      <div className="space-y-2">
        {allAchievements.map(({ token, claimers }) => {
          const isClaimed = claimers.length > 0;
          return (
            <div
              key={token.id}
              className={`rounded-lg border p-2.5 transition-colors ${
                isClaimed
                  ? 'bg-sand-200/60 border-sand-300/60'
                  : 'bg-sand-50 border-sand-300'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold ${isClaimed ? 'text-sand-500 line-through' : 'text-sand-800'}`}>
                    {token.name}
                  </p>
                  <p className="text-[0.65rem] text-sand-500 mt-0.5">{token.condition.description}</p>
                </div>
                {!isClaimed && (
                  <span className="shrink-0 w-5 h-5 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center text-[0.5rem] text-gold-dim font-bold">?</span>
                )}
              </div>

              {/* Who claimed it */}
              {isClaimed && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {claimers.map((c, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sand-300/50 text-[0.6rem] font-medium text-sand-700">
                      <span className="w-2 h-2 rounded-full" style={{ background: c.color }} />
                      {c.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
