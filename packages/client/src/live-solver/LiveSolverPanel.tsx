import React from 'react';
import type { LiveSolverMove, LiveSolverResult } from '../types';

interface LiveSolverPanelProps {
  pending: boolean;
  result: LiveSolverResult | null;
  onRefresh: () => void;
  onClose: () => void;
}

export const LiveSolverPanel: React.FC<LiveSolverPanelProps> = ({
  pending,
  result,
  onRefresh,
  onClose,
}) => {
  const currentMove = result?.currentMove ?? null;
  const leader = result?.projections[0] ?? null;
  const margin = result?.projectedMargin ?? null;
  const proofLabel = result?.proofStatus === 'PROVEN_OPTIMAL' ? 'Proven optimal' : 'Unproven';

  return (
    <aside className="fixed top-0 right-0 bottom-0 z-[60] w-[430px] max-w-[94vw] bg-sand-50 border-l border-sand-300 shadow-2xl flex flex-col">
      <div className="px-5 py-3 border-b border-sand-200 bg-sand-100 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-semibold text-sand-900">Live Solver</h2>
              <span className="px-1.5 py-0.5 rounded bg-terracotta/10 text-terracotta text-[0.65rem] font-bold uppercase tracking-wider">
                Playtest
              </span>
            </div>
            <p className="text-[0.7rem] text-sand-500 mt-0.5">
              {pending && result
                ? `Searching... best so far · ${result.computeMs}ms · ${result.searchedNodes.toLocaleString()} nodes`
                : pending
                  ? 'Searching...'
                  : result
                    ? `${result.computeMs}ms · ${result.searchedNodes.toLocaleString()} nodes · ${proofLabel}`
                    : 'Ready'}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onRefresh}
              className="px-2 py-1 rounded border border-sand-300 bg-white text-xs font-semibold text-sand-700 hover:bg-sand-100"
            >
              Refresh
            </button>
            <button
              onClick={onClose}
              className="text-sand-500 hover:text-sand-800 transition-colors text-xl leading-none"
              aria-label="Close"
            >
              &times;
            </button>
          </div>
        </div>
      </div>

      <div className="px-5 py-4 border-b border-sand-200 bg-white shrink-0">
        <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold mb-1">Do Now</p>
        {!result ? (
          <p className="text-sm text-sand-500">Waiting for the first search result.</p>
        ) : result.status !== 'READY' ? (
          <p className="text-sm text-sand-700">{result.message}</p>
        ) : currentMove ? (
          <MoveCallout move={currentMove} />
        ) : (
          <p className="text-sm text-sand-500">No player decision is needed right now.</p>
        )}
      </div>

      {result && result.status === 'READY' && (
        <div className="px-5 py-3 border-b border-sand-200 bg-sand-50 shrink-0">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold">Projection</p>
              <p className="font-display text-3xl font-bold text-terracotta leading-none mt-1">
                {margin === null ? '-' : margin > 0 ? `+${margin}` : margin}
              </p>
              <p className="text-[0.7rem] text-sand-500 mt-1">margin vs strongest opponent</p>
            </div>
            <div className="text-right">
              <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold">Leader</p>
              <p className="text-sm font-semibold text-sand-800 mt-1">{leader?.playerName ?? '-'}</p>
              <p className="text-[0.7rem] text-sand-500">{leader ? `${leader.projectedTotal} VP` : ''}</p>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {result.projections.map(score => (
              <div key={score.playerId} className="rounded border border-sand-200 bg-white px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-sand-800 truncate">{score.rank}. {score.playerName}</span>
                  <span className="text-xs text-sand-600">{score.projectedTotal}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 rounded border border-sand-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold">Proof</p>
              <span className={`text-[0.65rem] font-bold uppercase tracking-wider ${result.proofStatus === 'PROVEN_OPTIMAL' ? 'text-olive' : 'text-terracotta'}`}>
                {proofLabel}
              </span>
            </div>
            <p className="text-[0.7rem] text-sand-600 mt-1">
              {result.proofNodes.toLocaleString()} exact nodes · {opponentModelLabel(result.opponentModel)}
            </p>
            <p className="text-xs text-sand-700 mt-1">{result.proofReason}</p>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold mb-2">Path</p>
        {!result || result.rounds.length === 0 ? (
          <p className="text-xs text-sand-500 italic">The best line found so far will appear as soon as the search has one.</p>
        ) : (
          <div className="space-y-4">
            {result.rounds.map(round => (
              <section key={round.round}>
                <p className="text-xs font-bold text-sand-700 mb-1">Round {round.round}</p>
                <ol className="space-y-2">
                  {round.moves.map((move, index) => (
                    <li key={`${round.round}-${index}`} className="border-l-2 border-terracotta/30 pl-3">
                      <p className="text-sm font-semibold text-sand-800">{move.instruction}</p>
                      <p className="text-[0.7rem] text-sand-500">{phaseLabel(move.phase)} · about {move.estimatedSeconds}s</p>
                      {move.detail && <p className="text-xs text-sand-600 mt-0.5">{move.detail}</p>}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>

      {result && (
        <div className="px-5 py-2 border-t border-sand-200 text-[0.65rem] text-sand-500 shrink-0">
          {result.horizon === 'FULL_GAME' ? 'searched to final scoring' : 'partial horizon'}
          {' · '}
          {result.completedLines} completed line{result.completedLines === 1 ? '' : 's'}
          {pending ? ' · still searching' : ''}
        </div>
      )}
    </aside>
  );
};

const MoveCallout: React.FC<{ move: LiveSolverMove }> = ({ move }) => (
  <div>
    <p className="text-base font-semibold text-sand-900">{move.instruction}</p>
    <p className="text-xs text-sand-500 mt-1">
      {phaseLabel(move.phase)} · about {move.estimatedSeconds}s
    </p>
    {move.detail && <p className="text-sm text-sand-700 mt-2">{move.detail}</p>}
  </div>
);

function phaseLabel(phase: string): string {
  return phase
    .toLowerCase()
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function opponentModelLabel(model: LiveSolverResult['opponentModel']): string {
  return model === 'LIGHTWEIGHT_ACHIEVEMENT_EVENT_FIELD'
    ? 'achievement/event field'
    : 'adversarial field';
}
