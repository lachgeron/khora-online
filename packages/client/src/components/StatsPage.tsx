import React, { useEffect, useState } from 'react';
import { getStats } from '../api';

interface GameRecord {
  date: string;
  playerCount: number;
  rank: number;
  totalPoints: number;
  breakdown: {
    scoreTrackPoints: number;
    developmentPoints: number;
    politicsCardPoints: number;
    gloryKnowledgePoints: number;
  };
  city: string;
}

interface PlayerStats {
  games: GameRecord[];
}

interface StatsFile {
  players: Record<string, PlayerStats>;
}

export interface StatsPageProps {
  onBack: () => void;
}

const RANK_LABELS: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
const RANK_COLORS: Record<number, string> = {
  1: 'bg-gold/20 text-sand-900 border-gold',
  2: 'bg-sand-200 text-sand-700 border-sand-400',
  3: 'bg-amber-900/10 text-amber-900 border-amber-800/30',
  4: 'bg-sand-100 text-sand-500 border-sand-300',
};

/** Badge showing "in X-player game" */
const PlayerCountBadge: React.FC<{ count: number }> = ({ count }) => (
  <span className="text-[0.6rem] uppercase tracking-wide font-bold text-sand-400 ml-1">
    ({count}p)
  </span>
);

function PlacementGrid({ games, playerCount }: { games: GameRecord[]; playerCount: number }) {
  // Only show ranks that are possible for this player count
  const possibleRanks = Array.from({ length: playerCount }, (_, i) => i + 1);
  const countByRank: Record<number, number> = {};
  for (const r of possibleRanks) countByRank[r] = 0;
  for (const g of games) {
    if (g.rank <= playerCount) countByRank[g.rank] = (countByRank[g.rank] ?? 0) + 1;
  }

  return (
    <div className="flex gap-2">
      {possibleRanks.map(rank => (
        <div key={rank} className={`flex-1 text-center px-2 py-2 rounded-lg border ${RANK_COLORS[rank] ?? RANK_COLORS[4]}`}>
          <p className="text-lg font-bold tabular-nums">{countByRank[rank]}</p>
          <p className="text-[0.6rem] uppercase tracking-wide font-semibold">{RANK_LABELS[rank] ?? `${rank}th`}</p>
        </div>
      ))}
    </div>
  );
}

function PlayerStatsCard({ name, stats }: { name: string; stats: PlayerStats }) {
  const { games } = stats;
  if (games.length === 0) {
    return (
      <div className="bg-sand-50 border border-sand-200 rounded-xl px-5 py-4">
        <h3 className="font-display text-lg font-bold text-sand-800">{name}</h3>
        <p className="text-sand-400 text-sm mt-1">No games played yet.</p>
      </div>
    );
  }

  const wins = games.filter(g => g.rank === 1).length;
  const avgPoints = Math.round(games.reduce((s, g) => s + g.totalPoints, 0) / games.length);
  const bestScore = Math.max(...games.map(g => g.totalPoints));

  // Group games by player count
  const byPlayerCount = new Map<number, GameRecord[]>();
  for (const g of games) {
    const arr = byPlayerCount.get(g.playerCount) ?? [];
    arr.push(g);
    byPlayerCount.set(g.playerCount, arr);
  }
  // Sort descending by player count (4-player games first)
  const sortedCounts = [...byPlayerCount.keys()].sort((a, b) => b - a);

  return (
    <div className="bg-sand-50 border border-sand-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between">
        <div>
          <h3 className="font-display text-lg font-bold text-sand-800">{name}</h3>
          <p className="text-sand-500 text-xs">{games.length} game{games.length !== 1 ? 's' : ''} played</p>
        </div>
        <div className="flex gap-4 text-center">
          <div>
            <p className="text-xl font-bold text-gold">{wins}</p>
            <p className="text-[0.6rem] uppercase tracking-wide text-sand-500 font-semibold">Wins</p>
          </div>
          <div>
            <p className="text-xl font-bold text-sand-700">{avgPoints}</p>
            <p className="text-[0.6rem] uppercase tracking-wide text-sand-500 font-semibold">Avg VP</p>
          </div>
          <div>
            <p className="text-xl font-bold text-sand-700">{bestScore}</p>
            <p className="text-[0.6rem] uppercase tracking-wide text-sand-500 font-semibold">Best</p>
          </div>
        </div>
      </div>

      {/* Placement breakdown per player count */}
      <div className="px-5 pb-4 space-y-3">
        {sortedCounts.map(pc => {
          const pcGames = byPlayerCount.get(pc)!;
          return (
            <div key={pc}>
              <p className="text-[0.65rem] font-display uppercase tracking-[0.12em] text-sand-500 mb-1.5">
                {pc}-Player Games
                <span className="text-sand-400 normal-case tracking-normal ml-1">({pcGames.length} game{pcGames.length !== 1 ? 's' : ''})</span>
              </p>
              <PlacementGrid games={pcGames} playerCount={pc} />
            </div>
          );
        })}
      </div>

      {/* Recent games */}
      <div className="px-5 pb-4">
        <p className="text-[0.65rem] font-display uppercase tracking-[0.12em] text-sand-500 mb-1.5">Recent Games</p>
        <div className="space-y-1">
          {games.slice(-5).reverse().map((g, i) => (
            <div key={i} className="flex items-center justify-between text-xs px-3 py-1.5 bg-sand-100 rounded-lg">
              <div className="flex items-center gap-2">
                <span className={`font-bold ${g.rank === 1 ? 'text-gold' : 'text-sand-500'}`}>
                  {RANK_LABELS[g.rank] ?? `${g.rank}th`}
                </span>
                <PlayerCountBadge count={g.playerCount} />
                <span className="text-sand-500">{g.city}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold text-sand-700 tabular-nums">{g.totalPoints} VP</span>
                <span className="text-sand-400 text-[0.6rem]">{new Date(g.date).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const StatsPage: React.FC<StatsPageProps> = ({ onBack }) => {
  const [stats, setStats] = useState<StatsFile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStats()
      .then(data => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const playerNames = ['Pete', 'Ian', 'LachG', 'LJC'];

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="max-w-2xl w-full px-6 py-10">
        <h1 className="font-display text-3xl font-bold text-sand-800 text-center mb-1">Stats</h1>
        <p className="text-sand-500 italic text-center mb-8">Lifetime Records</p>

        {loading && <p className="text-sand-500 text-sm text-center">Loading stats...</p>}

        {!loading && stats && (
          <div className="space-y-4">
            {playerNames.map(name => (
              <PlayerStatsCard
                key={name}
                name={name}
                stats={stats.players[name] ?? { games: [] }}
              />
            ))}
          </div>
        )}

        {!loading && !stats && (
          <p className="text-sand-500 text-sm text-center">Could not load stats.</p>
        )}

        <div className="text-center mt-8">
          <button
            onClick={onBack}
            className="px-6 py-2.5 bg-sand-200 text-sand-700 rounded-lg font-semibold text-sm hover:bg-sand-300 transition-colors"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
};
