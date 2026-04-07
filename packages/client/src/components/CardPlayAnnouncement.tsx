import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { GameLogEntry } from '../types';

const TYPE_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  IMMEDIATE: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Immediate' },
  ONGOING: { bg: 'bg-emerald-100', text: 'text-emerald-800', label: 'Ongoing' },
  END_GAME: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'End Game' },
};

interface CardPlayAnnouncementProps {
  gameLog: GameLogEntry[];
  roundNumber: number;
  playerNames: Record<string, string>;
}

interface CardAnnouncement {
  key: string;
  playerName: string;
  cardName: string;
  cardType: string;
  cardDescription: string;
  cardCost: number;
  cardKnowledgeRequirement: { red: number; blue: number; green: number };
}

const DISPLAY_DURATION = 5000;

export const CardPlayAnnouncement: React.FC<CardPlayAnnouncementProps> = ({
  gameLog, roundNumber, playerNames,
}) => {
  const [announcement, setAnnouncement] = useState<CardAnnouncement | null>(null);
  const lastSeenCount = useRef(gameLog.length);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Check for new card play entries since last render
    if (gameLog.length <= lastSeenCount.current) {
      lastSeenCount.current = gameLog.length;
      return;
    }

    const newEntries = gameLog.slice(lastSeenCount.current);
    lastSeenCount.current = gameLog.length;

    // Find the most recent card play in this round
    let cardPlay: GameLogEntry | undefined;
    for (let i = newEntries.length - 1; i >= 0; i--) {
      const e = newEntries[i];
      if (e.roundNumber === roundNumber && e.phase === 'ACTIONS' && e.details?.cardName && e.details?.cardType) {
        cardPlay = e;
        break;
      }
    }

    if (!cardPlay) return;

    const d = cardPlay.details;
    const newAnnouncement: CardAnnouncement = {
      key: `${cardPlay.playerId}-${d.cardId}-${cardPlay.timestamp}`,
      playerName: playerNames[cardPlay.playerId ?? ''] ?? cardPlay.playerId ?? 'Unknown',
      cardName: d.cardName as string,
      cardType: d.cardType as string,
      cardDescription: (d.cardDescription as string) ?? '',
      cardCost: (d.cardCost as number) ?? 0,
      cardKnowledgeRequirement: (d.cardKnowledgeRequirement as { red: number; blue: number; green: number }) ?? { red: 0, blue: 0, green: 0 },
    };

    setAnnouncement(newAnnouncement);

    // Clear after duration
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setAnnouncement(null), DISPLAY_DURATION);
  }, [gameLog.length, roundNumber, playerNames]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const typeInfo = announcement ? TYPE_STYLE[announcement.cardType] : null;
  const req = announcement?.cardKnowledgeRequirement;

  return (
    <AnimatePresence>
      {announcement && typeInfo && (
        <motion.div
          key={announcement.key}
          initial={{ opacity: 0, y: -12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.3 }}
          className="rounded-xl border-2 border-sand-300 bg-white shadow-lg overflow-hidden"
        >
          {/* Header bar */}
          <div className="bg-sand-800 text-sand-100 px-4 py-2 flex items-center gap-2">
            <span className="text-base">🏛</span>
            <span className="font-display text-sm font-bold">{announcement.playerName}</span>
            <span className="text-sand-400 text-sm">played a card</span>
          </div>

          {/* Card display */}
          <div className="p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h4 className="font-display text-lg font-bold text-sand-900">
                {announcement.cardName}
              </h4>
              <span className={`shrink-0 px-2 py-0.5 rounded text-[0.6rem] font-bold uppercase ${typeInfo.bg} ${typeInfo.text}`}>
                {typeInfo.label}
              </span>
            </div>

            <p className="text-sm text-sand-600 leading-relaxed mb-3">
              {announcement.cardDescription}
            </p>

            <div className="flex items-center gap-3 text-xs text-sand-500">
              {announcement.cardCost > 0 && (
                <span className="flex items-center gap-1">
                  <span className="font-semibold">{announcement.cardCost}</span> 💰
                </span>
              )}
              {req && req.red > 0 && <span>{req.red} 🔴</span>}
              {req && req.blue > 0 && <span>{req.blue} 🔵</span>}
              {req && req.green > 0 && <span>{req.green} 🟢</span>}
              {announcement.cardCost === 0 && (!req || (req.red === 0 && req.blue === 0 && req.green === 0)) && (
                <span className="text-sand-400">Free</span>
              )}
            </div>

            {/* Timer bar */}
            <motion.div
              className="mt-3 h-0.5 bg-sand-300 rounded-full origin-left"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: DISPLAY_DURATION / 1000, ease: 'linear' }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
