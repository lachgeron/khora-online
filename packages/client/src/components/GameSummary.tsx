import React, { useState } from 'react';
import type { FinalScoreBoard, GameLogEntry, PublicGameState, PublicPlayerState, AchievementToken } from '../types';
import { GameLog } from './GameLog';

export interface GameSummaryProps {
  finalScores: FinalScoreBoard;
  gameLog: GameLogEntry[];
  gameState: PublicGameState;
}

const TrackBar: React.FC<{ label: string; value: number; max: number; color: string }> = ({ label, value, max, color }) => (
  <div className="flex items-center gap-2">
    <span className="text-[0.6rem] text-sand-500 w-14 text-right">{label}</span>
    <div className="flex-1 flex gap-px">
      {Array.from({ length: max }, (_, i) => (
        <div key={i} className={`h-3 flex-1 ${i === 0 ? 'rounded-l' : ''} ${i === max - 1 ? 'rounded-r' : ''}`}
          style={{ background: i < value ? color : '#e8dcc6' }} />
      ))}
    </div>
    <span className="text-[0.6rem] font-bold text-sand-700 w-4">{value}</span>
  </div>
);

const PlayerCard: React.FC<{
  player: PublicPlayerState;
  rank: number;
  totalPoints: number;
  averageDiceRoll: number | null;
  breakdown: { scoreTrackPoints: number; developmentPoints: number; politicsCardPoints: number; gloryKnowledgePoints: number; detailedSources: { label: string; points: number }[] };
  isWinner: boolean;
  achievements: AchievementToken[];
  cityName: string;
}> = ({ player: p, rank, totalPoints, averageDiceRoll, breakdown, isWinner, achievements, cityName }) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`rounded-xl overflow-hidden ${
      isWinner ? 'bg-gold/15 border-2 border-gold ring-2 ring-gold/20' : 'bg-sand-50 border border-sand-200'
    }`}>
      {/* Header */}
      <button onClick={() => setExpanded(!expanded)} className="w-full px-5 py-4 text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`text-xs font-bold uppercase tracking-wider ${isWinner ? 'text-gold' : 'text-sand-400'}`}>#{rank}</span>
            <div>
              <span className={`text-lg ${isWinner ? 'font-bold text-sand-900' : 'font-semibold text-sand-700'}`}>{p.playerName}</span>
              <span className="text-xs text-sand-400 ml-2">{cityName}</span>
            </div>
            {isWinner && <span className="text-xs font-semibold bg-gold text-sand-900 px-2 py-0.5 rounded-full">Winner</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-2xl font-bold ${isWinner ? 'text-sand-900' : 'text-sand-700'}`}>{totalPoints} VP</span>
            <span className="text-sand-400 text-sm">{expanded ? '▾' : '▸'}</span>
          </div>
        </div>

        {/* VP sources — always visible */}
        <div className="mt-3 space-y-1">
          {breakdown.detailedSources.map((src, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-sand-600">{src.label}</span>
              <span className="font-bold text-sand-800 tabular-nums">+{src.points}</span>
            </div>
          ))}
          <div className="flex items-center justify-between text-xs border-t border-sand-300/50 pt-1 mt-1">
            <span className="font-semibold text-sand-700">Total</span>
            <span className="font-bold text-sand-900 tabular-nums">{totalPoints} VP</span>
          </div>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-5 pb-4 space-y-3 border-t border-sand-200/50 pt-3">
          {/* Progress tracks */}
          <div>
            <p className="text-[0.6rem] font-display uppercase tracking-[0.12em] text-sand-500 mb-1">Progress</p>
            <div className="space-y-1">
              <TrackBar label="Economy" value={p.economyTrack} max={7} color="#c9a84c" />
              <TrackBar label="Culture" value={p.cultureTrack} max={7} color="#7a9450" />
              <TrackBar label="Military" value={p.militaryTrack} max={7} color="#b85c38" />
            </div>
          </div>

          {/* Other tracks */}
          <div>
            <p className="text-[0.6rem] font-display uppercase tracking-[0.12em] text-sand-500 mb-1">Tracks</p>
            <div className="space-y-1">
              <TrackBar label="Tax" value={p.taxTrack} max={10} color="#8b6914" />
              <TrackBar label="Glory" value={p.gloryTrack} max={10} color="#9060a0" />
              <TrackBar label="Troops" value={p.troopTrack} max={15} color="#606878" />
              <TrackBar label="Citizens" value={p.citizenTrack} max={15} color="#4a7a9e" />
            </div>
          </div>

          {/* Resources & Development */}
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="px-2 py-1 bg-sand-200 rounded-full">💰 {p.victoryPoints} VP</span>
            <span className="px-2 py-1 bg-sand-200 rounded-full">🔨 Dev {p.developmentLevel}/4</span>
            <span className="px-2 py-1 bg-sand-200 rounded-full">🃏 {p.playedCardCount} cards played</span>
            <span className="px-2 py-1 bg-sand-200 rounded-full">🎴 {p.handCardCount} in hand</span>
            <span className="px-2 py-1 bg-sand-200 rounded-full">🔮 {p.knowledgeTokenCount} tokens</span>
            <span className="px-2 py-1 bg-sand-200 rounded-full">🎲 Avg {averageDiceRoll?.toFixed(1) ?? 'n/a'}</span>
          </div>

          {/* Played cards */}
          {p.playedCardSummaries.length > 0 && (
            <div>
              <p className="text-[0.6rem] font-display uppercase tracking-[0.12em] text-sand-500 mb-1">Cards in Play</p>
              <div className="flex flex-wrap gap-1">
                {p.playedCardSummaries.map((c, i) => {
                  const typeColor = c.type === 'IMMEDIATE' ? 'bg-amber-100 text-amber-800'
                    : c.type === 'ONGOING' ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-purple-100 text-purple-800';
                  return (
                    <span key={i} className={`px-2 py-0.5 rounded text-[0.6rem] font-medium ${typeColor}`}>
                      {c.name}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Achievements */}
          {achievements.length > 0 && (
            <div>
              <p className="text-[0.6rem] font-display uppercase tracking-[0.12em] text-sand-500 mb-1">Achievements ({achievements.length})</p>
              <div className="flex flex-wrap gap-1">
                {achievements.map(a => (
                  <span key={a.id} className="px-2 py-0.5 rounded bg-gold/20 text-sand-800 text-[0.6rem] font-medium">
                    🏆 {a.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const GameSummary: React.FC<GameSummaryProps> = ({ finalScores, gameLog, gameState }) => {
  const [showLog, setShowLog] = useState(false);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="max-w-2xl w-full px-6 py-10">
        <h1 className="font-display text-3xl font-bold text-sand-800 text-center mb-1">Game Over</h1>
        <p className="text-sand-500 italic text-center mb-8">Final Standings</p>

        <div className="space-y-4">
          {finalScores.rankings.map((score) => {
            const player = gameState.players.find(p => p.playerId === score.playerId);
            const achievements = gameState.claimedAchievements[score.playerId] ?? [];
            const cityCard = player ? gameState.cityCards?.[player.cityId] : undefined;
            const cityName = cityCard?.name ?? player?.cityId ?? '';

            return player ? (
              <PlayerCard
                key={score.playerId}
                player={player}
                rank={score.rank}
                totalPoints={score.totalPoints}
                averageDiceRoll={score.averageDiceRoll}
                breakdown={score.breakdown}
                isWinner={score.playerId === finalScores.winnerId}
                achievements={achievements}
                cityName={cityName}
              />
            ) : null;
          })}
        </div>

        <div className="text-center mt-8">
          <button
            onClick={() => setShowLog(!showLog)}
            className="px-4 py-2 bg-sand-100 text-sand-600 rounded-lg text-sm hover:bg-sand-200 transition-colors"
          >
            {showLog ? 'Hide Game Log' : 'View Game Log'}
          </button>
        </div>

        {showLog && (
          <div className="mt-4">
            <GameLog entries={gameLog} />
          </div>
        )}
      </div>
    </div>
  );
};
