import React, { useState } from 'react';
import type { SolverResult, RoundPlan, Plan } from '../types';

interface SolverPanelProps {
  result: SolverResult | null;
  stale: boolean;
  onClose: () => void;
}

/**
 * Persistent solver-mode panel. Non-blocking right-edge sidebar showing a
 * live projection of best-possible final VP plus the recommended next move.
 * Full plan (current + future rounds) is collapsible.
 *
 * While stale (after a state change, before a fresh result arrives) the
 * content is greyed out and a spinner is shown.
 */
export const SolverPanel: React.FC<SolverPanelProps> = ({ result, stale, onClose }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="fixed top-0 right-0 bottom-0 z-[50] w-[420px] max-w-[92vw] bg-sand-50 border-l border-sand-300 shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-sand-200 shrink-0 bg-sand-100">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-sand-900">
            Oracle's Vision
          </h2>
          <span className="text-[0.65rem] uppercase tracking-wider text-terracotta font-bold px-1.5 py-0.5 bg-terracotta/10 rounded">
            Live
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-sand-500 hover:text-sand-800 transition-colors text-xl leading-none"
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {result === null ? (
          <InitialView />
        ) : !result.ok ? (
          <UnavailableView message={result.message} stale={stale} />
        ) : (
          <PlanView plan={result.plan} stale={stale} expanded={expanded} onToggleExpanded={() => setExpanded((v) => !v)} />
        )}
      </div>
    </div>
  );
};

const InitialView: React.FC = () => (
  <div className="flex flex-col items-center justify-center py-16 gap-3">
    <div className="w-10 h-10 border-4 border-sand-300 border-t-terracotta rounded-full animate-spin" />
    <p className="text-sand-700 text-sm">Consulting the oracle…</p>
  </div>
);

const UnavailableView: React.FC<{ message: string; stale: boolean }> = ({ message, stale }) => (
  <div className={`flex flex-col items-center justify-center py-16 gap-2 px-6 text-center transition-opacity ${stale ? 'opacity-40' : ''}`}>
    <p className="text-sand-800 font-semibold">The oracle cannot speak now.</p>
    <p className="text-sand-500 text-sm">{message}</p>
  </div>
);

const PlanView: React.FC<{
  plan: Plan;
  stale: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}> = ({ plan, stale, expanded, onToggleExpanded }) => {
  const bestMove = plan.currentRound?.description?.[0] ?? null;

  return (
    <div className={`flex flex-col h-full transition-opacity duration-200 ${stale ? 'opacity-50' : 'opacity-100'}`}>
      {/* Eval bar: projected final VP */}
      <div className="px-5 py-4 bg-sand-100 border-b border-sand-200 shrink-0 relative">
        {stale && (
          <div className="absolute top-2 right-2 w-4 h-4 border-2 border-sand-300 border-t-terracotta rounded-full animate-spin" aria-label="Recomputing" />
        )}
        <div className="flex items-baseline gap-3">
          <span className="font-display text-4xl font-bold text-terracotta leading-none">
            {plan.projectedFinalVP}
          </span>
          <span className="text-sand-600 text-xs uppercase tracking-wider">projected final VP</span>
        </div>
        <div className="mt-2 text-[0.7rem] text-sand-600 flex flex-wrap gap-x-3">
          <span>Track: <b>{plan.vpBreakdown.scoreTrack}</b></span>
          <span>Cards: <b>{plan.vpBreakdown.politicsCards}</b></span>
          <span>Devs: <b>{plan.vpBreakdown.developments}</b></span>
          <span>Glory×majors: <b>{plan.vpBreakdown.gloryTimesMajors}</b></span>
        </div>
      </div>

      {/* Best next move */}
      {bestMove && plan.currentRound && (
        <div className="px-5 py-3 bg-terracotta/5 border-b border-terracotta/20 shrink-0">
          <p className="text-[0.65rem] uppercase tracking-wider text-terracotta font-bold mb-1">
            Best Next Move (Round {plan.currentRound.round})
          </p>
          <p className="text-sand-800 text-sm font-medium">{bestMove}</p>
        </div>
      )}

      {/* Expand / collapse */}
      <button
        onClick={onToggleExpanded}
        className="px-5 py-2 text-left text-[0.7rem] uppercase tracking-wider text-sand-600 font-bold border-b border-sand-200 hover:bg-sand-100 transition-colors shrink-0 flex items-center justify-between"
      >
        <span>Full Plan</span>
        <span className="text-sand-400">{expanded ? '▾' : '▸'}</span>
      </button>

      {expanded && (
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {plan.currentRound && (
            <div className="mb-4">
              <p className="text-[0.65rem] uppercase tracking-wider text-terracotta font-bold mb-1">
                This Turn (Round {plan.currentRound.round})
              </p>
              <RoundBody round={plan.currentRound} />
            </div>
          )}

          <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold mb-2">
            Future Rounds
          </p>
          {plan.futureRounds.length === 0 ? (
            <p className="text-xs text-sand-500 italic">No further rounds to plan.</p>
          ) : (
            <ul className="space-y-3">
              {plan.futureRounds.map((round) => (
                <li key={round.round} className="border-l-2 border-sand-300 pl-3">
                  <p className="text-xs font-semibold text-sand-700 mb-1">Round {round.round}</p>
                  <RoundBody round={round} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-2 border-t border-sand-200 text-[0.65rem] text-sand-500 shrink-0 flex gap-3 mt-auto">
        <span>last update {plan.computeMs}ms</span>
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
