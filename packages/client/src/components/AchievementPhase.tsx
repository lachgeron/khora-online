import React, { useState } from 'react';
import type { AchievementToken } from '../types';
import { CountdownTimer } from './CountdownTimer';

export interface AchievementPhaseProps {
  claimableAchievements: AchievementToken[];
  pendingDecisions: { playerId: string; decisionType: string; timeoutAt: number }[];
  currentPlayerId: string;
  onClaim: (achievementId: string, trackChoice: 'TAX' | 'GLORY') => void;
  onSkip: () => void;
}

export const AchievementPhase: React.FC<AchievementPhaseProps> = ({
  claimableAchievements,
  pendingDecisions,
  currentPlayerId,
  onClaim,
  onSkip,
}) => {
  const [trackChoice, setTrackChoice] = useState<'TAX' | 'GLORY'>('TAX');

  const myPending = pendingDecisions.filter(
    d => d.playerId === currentPlayerId && d.decisionType === 'ACHIEVEMENT_TRACK_CHOICE',
  );
  const othersWaiting = pendingDecisions.some(
    d => d.playerId !== currentPlayerId && d.decisionType === 'ACHIEVEMENT_TRACK_CHOICE',
  );

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="font-display text-base font-semibold text-sand-800">Achievement Phase</h3>
        {myPending.length > 0 && <CountdownTimer timeoutAt={myPending[0].timeoutAt} />}
      </div>

      {myPending.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-sand-600">
            🏆 You earned {myPending.length} achievement{myPending.length > 1 ? 's' : ''}! Choose a reward for each:
          </p>
          <div className="rounded-xl border-2 border-gold bg-gold/5 p-5">
            <p className="text-xs font-display uppercase tracking-[0.12em] text-sand-500 mb-1">
              Achievement {myPending.length > 1 ? `1 of ${myPending.length}` : ''}
            </p>
            <p className="text-sm font-semibold text-sand-800 mb-3">Choose your reward:</p>
            <div className="flex gap-3 mb-4">
              <button
                onClick={() => setTrackChoice('TAX')}
                className={`flex-1 py-3 rounded-lg border-2 text-sm font-semibold transition-all ${
                  trackChoice === 'TAX'
                    ? 'border-amber-500 bg-amber-50 text-amber-800 shadow-sm'
                    : 'border-sand-300 bg-sand-50 text-sand-600 hover:border-sand-400'
                }`}
              >
                💰 +1 Tax
              </button>
              <button
                onClick={() => setTrackChoice('GLORY')}
                className={`flex-1 py-3 rounded-lg border-2 text-sm font-semibold transition-all ${
                  trackChoice === 'GLORY'
                    ? 'border-purple-500 bg-purple-50 text-purple-800 shadow-sm'
                    : 'border-sand-300 bg-sand-50 text-sand-600 hover:border-sand-400'
                }`}
              >
                👑 +1 Glory
              </button>
            </div>
            <button
              onClick={() => { onClaim('', trackChoice); setTrackChoice('TAX'); }}
              className="w-full py-2.5 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim transition-colors"
            >
              Confirm
            </button>
          </div>

          {myPending.length > 1 && (
            <div className="rounded-lg bg-sand-100 border border-sand-200 p-3">
              <p className="text-xs text-sand-500">
                {myPending.length - 1} more reward{myPending.length - 1 > 1 ? 's' : ''} to choose after this one
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-sand-500">
          {othersWaiting
            ? <p>Waiting for other players to choose their rewards...</p>
            : <p>No achievements earned this round.</p>
          }
        </div>
      )}

      {claimableAchievements.length > 0 && (
        <div className="mt-4">
          <p className="text-[0.65rem] font-display uppercase tracking-[0.12em] text-sand-500 mb-1.5">Still available</p>
          <div className="space-y-1">
            {claimableAchievements.map(a => (
              <p key={a.id} className="text-xs text-sand-600">
                <span className="font-semibold text-sand-800">{a.name}</span> — {a.condition.description}
              </p>
            ))}
          </div>
        </div>
      )}

      {myPending.length === 0 && !othersWaiting && (
        <button
          onClick={onSkip}
          className="mt-3 px-4 py-2 bg-sand-300 text-sand-800 rounded-lg text-sm font-medium hover:bg-sand-400 transition-colors"
        >
          Continue
        </button>
      )}
    </div>
  );
};
