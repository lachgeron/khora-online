import React from 'react';
import type { SolverResult, RoundPlan } from '../types';

interface SolverModalProps {
  state: 'computing' | 'done' | 'error';
  result: SolverResult | null;
  onClose: () => void;
}

/**
 * Non-blocking right-edge sidebar so the game remains playable while the solver
 * computes. No backdrop, no click-outside-to-close — the game UI stays interactive.
 * The name is kept for compatibility with existing imports.
 */
export const SolverModal: React.FC<SolverModalProps> = ({ state, result, onClose }) => {
  return (
    <div
      className="fixed top-0 right-0 bottom-0 z-[50] w-[420px] max-w-[92vw] bg-sand-50 border-l border-sand-300 shadow-2xl flex flex-col"
    >
      <div className="flex items-center justify-between px-5 py-3 border-b border-sand-200 shrink-0 bg-sand-100">
        <h2 className="font-display text-lg font-semibold text-sand-900">
          Oracle's Vision
        </h2>
        <button
          onClick={onClose}
          className="text-sand-500 hover:text-sand-800 transition-colors text-xl leading-none"
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      <div className="flex-1 overflow-hidden">
        {state === 'computing' && <ComputingView />}
        {state === 'done' && result && <DoneView result={result} />}
        {state === 'error' && <ErrorView />}
      </div>
    </div>
  );
};

const ComputingView: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-16 gap-3">
    <div className="w-10 h-10 border-4 border-sand-300 border-t-terracotta rounded-full animate-spin" />
    <p className="text-sand-700 text-sm">Consulting the oracle…</p>
    <p className="text-sand-500 text-xs">This may take up to 25 seconds.</p>
  </div>
);

const ErrorView: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-16 gap-2">
    <p className="text-sand-800 font-semibold">The oracle is silent.</p>
    <p className="text-sand-500 text-sm">Something went wrong during divination.</p>
  </div>
);

const DoneView: React.FC<{ result: SolverResult }> = ({ result }) => {
  if (!result.ok) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 px-6 text-center">
        <p className="text-sand-800 font-semibold">The oracle cannot speak now.</p>
        <p className="text-sand-500 text-sm">{result.message}</p>
      </div>
    );
  }

  const { plan } = result;

  return (
    <div className="flex flex-col h-full max-h-[78vh]">
      {/* Header: projected VP + breakdown */}
      <div className="px-5 py-3 bg-sand-100 border-b border-sand-200 shrink-0">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-3xl font-bold text-terracotta">
            {plan.projectedFinalVP}
          </span>
          <span className="text-sand-600 text-sm">projected final VP</span>
          {plan.partialResult && (
            <span className="ml-auto text-xs text-sand-500 italic">partial result (timeout)</span>
          )}
        </div>
        <div className="mt-1 text-xs text-sand-600 flex flex-wrap gap-x-3">
          <span>Score track: <b>{plan.vpBreakdown.scoreTrack}</b></span>
          <span>Cards: <b>{plan.vpBreakdown.politicsCards}</b></span>
          <span>Developments: <b>{plan.vpBreakdown.developments}</b></span>
          <span>Glory × majors: <b>{plan.vpBreakdown.gloryTimesMajors}</b></span>
        </div>
      </div>

      {/* Current round (separated) */}
      {plan.currentRound && (
        <div className="px-5 py-3 bg-terracotta/5 border-b border-terracotta/20 shrink-0">
          <p className="text-[0.65rem] uppercase tracking-wider text-terracotta font-bold mb-1">
            This Turn (Round {plan.currentRound.round})
          </p>
          <RoundBody round={plan.currentRound} />
        </div>
      )}

      {/* Future rounds (scrollable) */}
      <div className="flex-1 overflow-y-auto px-5 py-3">
        <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold mb-2">
          Future Rounds
        </p>
        {plan.futureRounds.length === 0 ? (
          <p className="text-xs text-sand-500 italic">No further rounds to plan.</p>
        ) : (
          <ul className="space-y-3">
            {plan.futureRounds.map(round => (
              <li key={round.round} className="border-l-2 border-sand-300 pl-3">
                <p className="text-xs font-semibold text-sand-700 mb-1">
                  Round {round.round}
                </p>
                <RoundBody round={round} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-2 border-t border-sand-200 text-[0.65rem] text-sand-500 shrink-0 flex gap-3">
        <span>computed in {plan.computeMs}ms</span>
        <span>nodes: {plan.exploredNodes.toLocaleString()}</span>
      </div>
    </div>
  );
};

const RoundBody: React.FC<{ round: RoundPlan }> = ({ round }) => (
  <div>
    <ul className="list-disc list-inside space-y-0.5 text-sm text-sand-800">
      {round.description.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
    <p className="text-[0.65rem] text-sand-500 mt-1">
      VP: {round.vpBefore} → {round.vpAfter}
      {'  |  '}
      Coins: {round.coinsBefore} → {round.coinsAfter}
    </p>
  </div>
);
