import React, { useState, useRef, useCallback } from 'react';
import type { PublicGameState } from '../types';
import { CountdownTimer } from './CountdownTimer';
import { StandingsRecap } from './StandingsRecap';
import type { PlayerEffect } from './StandingsRecap';
import { motion, AnimatePresence } from 'framer-motion';

export interface AchievementPhaseProps {
  gameState: PublicGameState;
  currentPlayerId: string;
  onClaim: (achievementId: string, trackChoice: 'TAX' | 'GLORY') => void;
  onSkip: () => void;
}

interface FlyingReward {
  key: number;
  track: 'TAX' | 'GLORY';
  startX: number;
  startY: number;
}

export const AchievementPhase: React.FC<AchievementPhaseProps> = ({
  gameState,
  currentPlayerId,
  onClaim,
  onSkip,
}) => {
  const [trackChoice, setTrackChoice] = useState<'TAX' | 'GLORY'>('TAX');
  const [flyingRewards, setFlyingRewards] = useState<FlyingReward[]>([]);
  const [claimingAnim, setClaimingAnim] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const rewardKeyRef = useRef(0);

  const { pendingDecisions, availableAchievements: claimableAchievements } = gameState;

  const myPending = pendingDecisions.filter(
    d => d.playerId === currentPlayerId && d.decisionType === 'ACHIEVEMENT_TRACK_CHOICE',
  );
  const othersWaiting = pendingDecisions.some(
    d => d.playerId !== currentPlayerId && d.decisionType === 'ACHIEVEMENT_TRACK_CHOICE',
  );
  const isDisplayPhase = pendingDecisions.length === 1 && pendingDecisions[0].decisionType === 'PHASE_DISPLAY';
  const showRecap = isDisplayPhase || (myPending.length === 0 && !othersWaiting && pendingDecisions.length === 0);

  // Build achievement effect badges from game log
  const achievementEffects: Record<string, PlayerEffect[]> = {};
  for (const entry of gameState.gameLog) {
    if (entry.roundNumber === gameState.roundNumber && entry.phase === 'ACHIEVEMENT' && entry.playerId) {
      if (!achievementEffects[entry.playerId]) achievementEffects[entry.playerId] = [];
      if (entry.action.startsWith('Claimed achievement:')) {
        const name = entry.action.replace('Claimed achievement: ', '');
        achievementEffects[entry.playerId].push({ text: name, type: 'gain' });
      }
      if (entry.action.startsWith('Chose +1')) {
        achievementEffects[entry.playerId].push({ text: entry.action.replace('Chose ', ''), type: 'gain' });
      }
    }
  }

  const handleConfirm = useCallback(() => {
    if (!confirmRef.current || claimingAnim) return;

    // Get button position for flying animation origin
    const rect = confirmRef.current.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    const key = ++rewardKeyRef.current;
    setFlyingRewards(prev => [...prev, { key, track: trackChoice, startX, startY }]);
    setClaimingAnim(true);

    // Delay the actual claim so the animation plays first
    setTimeout(() => {
      onClaim('', trackChoice);
      setTrackChoice('TAX');
      setClaimingAnim(false);
    }, 600);
  }, [trackChoice, onClaim, claimingAnim]);

  const removeFlyingReward = useCallback((key: number) => {
    setFlyingRewards(prev => prev.filter(r => r.key !== key));
  }, []);

  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <h3 className="font-display text-base font-semibold text-sand-800">Achievement Phase</h3>
        {myPending.length > 0 && <CountdownTimer timeoutAt={myPending[0].timeoutAt} usingTimeBank={myPending[0].usingTimeBank} />}
      </div>

      {myPending.length > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-sand-600">
            You earned {myPending.length} achievement{myPending.length > 1 ? 's' : ''}! Choose a reward for each:
          </p>

          <motion.div
            className="rounded-xl border-2 border-gold bg-gold/5 p-5"
            animate={claimingAnim ? { scale: [1, 1.03, 1], borderColor: ['#c9a84c', '#ffd700', '#c9a84c'] } : {}}
            transition={{ duration: 0.5 }}
          >
            <p className="text-xs font-display uppercase tracking-[0.12em] text-sand-500 mb-1">
              Achievement {myPending.length > 1 ? `1 of ${myPending.length}` : ''}
            </p>
            {/* Show achievement name from game log */}
            {(() => {
              const myAchievements = gameState.gameLog
                .filter(e => e.roundNumber === gameState.roundNumber && e.phase === 'ACHIEVEMENT'
                  && e.playerId === currentPlayerId && e.action.startsWith('Claimed achievement:'))
                .map(e => e.action.replace('Claimed achievement: ', ''));
              const currentIdx = myAchievements.length - myPending.length;
              const name = myAchievements[currentIdx >= 0 ? currentIdx : 0];
              return name ? (
                <p className="text-sm font-bold text-gold-dim mb-2">{name}</p>
              ) : null;
            })()}
            <p className="text-sm font-semibold text-sand-800 mb-3">Choose your reward:</p>
            <div className="flex gap-3 mb-4">
              <motion.button
                onClick={() => setTrackChoice('TAX')}
                whileTap={{ scale: 0.95 }}
                className={`flex-1 py-3 rounded-lg border-2 text-sm font-semibold transition-all ${
                  trackChoice === 'TAX'
                    ? 'border-amber-500 bg-amber-50 text-amber-800 shadow-sm'
                    : 'border-sand-300 bg-sand-50 text-sand-600 hover:border-sand-400'
                }`}
              >
                <span className="block text-lg mb-0.5">💰</span>
                +1 Tax
              </motion.button>
              <motion.button
                onClick={() => setTrackChoice('GLORY')}
                whileTap={{ scale: 0.95 }}
                className={`flex-1 py-3 rounded-lg border-2 text-sm font-semibold transition-all ${
                  trackChoice === 'GLORY'
                    ? 'border-purple-500 bg-purple-50 text-purple-800 shadow-sm'
                    : 'border-sand-300 bg-sand-50 text-sand-600 hover:border-sand-400'
                }`}
              >
                <span className="block text-lg mb-0.5">✨</span>
                +1 Glory
              </motion.button>
            </div>
            <motion.button
              ref={confirmRef}
              onClick={handleConfirm}
              disabled={claimingAnim}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="w-full py-2.5 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim transition-colors disabled:opacity-60"
            >
              {claimingAnim ? 'Claiming...' : 'Confirm'}
            </motion.button>
          </motion.div>

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
            : !showRecap && <p>No achievements earned this round.</p>
          }
        </div>
      )}

      {claimableAchievements.length > 0 && !showRecap && (
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

      {showRecap && (
        <>
          <StandingsRecap
            gameState={gameState}
            currentPlayerId={currentPlayerId}
            playerEffects={achievementEffects}
            title={`End of Round ${gameState.roundNumber}`}
          />
          <p className="text-xs text-sand-400 mt-3 text-center animate-pulse">Continuing shortly...</p>
        </>
      )}

      {/* Flying reward badges — fixed position so they fly across the viewport */}
      <AnimatePresence>
        {flyingRewards.map(reward => (
          <motion.div
            key={reward.key}
            className="fixed z-50 pointer-events-none"
            style={{ left: reward.startX, top: reward.startY }}
            initial={{ x: 0, y: 0, scale: 1.5, opacity: 1 }}
            animate={{
              x: -(reward.startX - 120),
              y: window.innerHeight - reward.startY - 80,
              scale: 0.8,
              opacity: 0,
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 1.2,
              ease: [0.25, 0.1, 0.25, 1],
              opacity: { duration: 1.2, delay: 0.4 },
            }}
            onAnimationComplete={() => removeFlyingReward(reward.key)}
          >
            <div className={`px-4 py-2 rounded-full font-bold text-sm shadow-lg ${
              reward.track === 'TAX'
                ? 'bg-amber-400 text-amber-900 border-2 border-amber-500'
                : 'bg-purple-400 text-purple-900 border-2 border-purple-500'
            }`}>
              {reward.track === 'TAX' ? '💰 +1 Tax' : '✨ +1 Glory'}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
