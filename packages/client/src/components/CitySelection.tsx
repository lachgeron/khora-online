import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CityCard } from '../types';
import { CountdownTimer } from './CountdownTimer';

export interface CitySelectionProps {
  offeredCities: CityCard[] | null;
  pickOrder: string[];
  currentPickerIndex: number;
  selections: Record<string, string>;
  allCities: CityCard[];
  currentPlayerId: string;
  playerNames: Record<string, string>;
  pendingDecisions?: { playerId: string; decisionType: string; timeoutAt: number; usingTimeBank?: boolean }[];
  onSelectCity: (cityId: string) => void;
}

const DEV_TYPE_STYLE: Record<string, string> = {
  IMMEDIATE: 'bg-amber-100 text-amber-800',
  ONGOING: 'bg-emerald-100 text-emerald-800',
  END_GAME: 'bg-purple-100 text-purple-800',
};

export const CitySelection: React.FC<CitySelectionProps> = ({
  offeredCities, pickOrder, currentPickerIndex, selections, allCities,
  currentPlayerId, playerNames, pendingDecisions, onSelectCity,
}) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const currentPickerId = pickOrder[currentPickerIndex];
  const isMyTurn = currentPickerId === currentPlayerId;
  const pickedEntries = Object.entries(selections);

  return (
    <div className="col-span-full max-w-3xl mx-auto py-8">
      <h2 className="font-display text-2xl font-bold text-sand-800 text-center mb-1">Choose Your City</h2>
      <p className="text-sm text-sand-500 text-center mb-4">
        {isMyTurn ? 'Pick a city-state to lead' : `Waiting for ${playerNames[currentPickerId] ?? '...'} to pick...`}
      </p>

      {/* Timer */}
      {isMyTurn && (() => {
        const myDecision = pendingDecisions?.find(d => d.playerId === currentPlayerId);
        return myDecision ? (
          <div className="max-w-xs mx-auto mb-6">
            <CountdownTimer timeoutAt={myDecision.timeoutAt} usingTimeBank={myDecision.usingTimeBank} />
          </div>
        ) : null;
      })()}

      {/* Already picked */}
      {pickedEntries.length > 0 && (
        <div className="flex justify-center gap-3 mb-6">
          {pickedEntries.map(([pid, cityId]) => {
            const city = allCities.find(c => c.id === cityId);
            return (
              <span key={pid} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sand-200 text-xs font-medium text-sand-700">
                {playerNames[pid] ?? pid} → {city?.name ?? cityId}
              </span>
            );
          })}
        </div>
      )}

      {/* City cards */}
      {isMyTurn && offeredCities && (
        <div className="space-y-3">
          <AnimatePresence>
            {offeredCities.map((city, i) => {
              const isSelected = selectedId === city.id;
              return (
                <motion.div
                  key={city.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  onClick={() => setSelectedId(city.id)}
                  className={`cursor-pointer rounded-xl border-2 p-5 transition-all ${
                    isSelected
                      ? 'border-gold bg-gold/5 shadow-lg'
                      : 'border-sand-200 bg-sand-50 hover:border-sand-400 hover:shadow-sm'
                  }`}
                >
                  <h3 className="font-display text-lg font-bold text-sand-800 mb-3">{city.name}</h3>

                  {/* Developments — each on its own line */}
                  <div className="space-y-2">
                    {city.developments.map((dev, di) => {
                      const isStarting = di === 0;
                      return (
                        <div key={dev.id} className={`flex items-start gap-3 rounded-lg px-3 py-2 ${
                          isStarting ? 'bg-gold/10 border border-gold/30' : 'bg-sand-100/80'
                        }`}>
                          <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            isStarting ? 'bg-gold text-sand-900' : 'bg-sand-700 text-sand-100'
                          }`}>
                            {di + 1}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-sand-800">{dev.name}</span>
                              <span className={`shrink-0 px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase ${DEV_TYPE_STYLE[dev.effectType] ?? ''}`}>
                                {dev.effectType.replace('_', ' ')}
                              </span>
                              {isStarting && (
                                <span className="shrink-0 px-1.5 py-0.5 rounded text-[0.55rem] font-bold uppercase bg-gold/20 text-gold-dim">
                                  Starting
                                </span>
                              )}
                            </div>
                            {/* Cost */}
                            <div className="text-[0.7rem] text-sand-400 mt-0.5">
                              {isStarting ? (
                                <span className="text-gold-dim font-medium">Free — active from the start</span>
                              ) : (
                                <>
                                  {dev.drachmaCost > 0 && <span>{dev.drachmaCost}💰 </span>}
                                  {dev.knowledgeRequirement.red > 0 && <span>{dev.knowledgeRequirement.red}🔴 </span>}
                                  {dev.knowledgeRequirement.blue > 0 && <span>{dev.knowledgeRequirement.blue}🔵 </span>}
                                  {dev.knowledgeRequirement.green > 0 && <span>{dev.knowledgeRequirement.green}🟢 </span>}
                                  {dev.drachmaCost === 0 && !dev.knowledgeRequirement.red && !dev.knowledgeRequirement.blue && !dev.knowledgeRequirement.green && <span>Free</span>}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Select button */}
                  {isSelected && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={(e) => { e.stopPropagation(); onSelectCity(city.id); }}
                      className="mt-4 w-full py-3 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim transition-colors"
                    >
                      Choose {city.name}
                    </motion.button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};
