import React, { useState } from 'react';
import type { ScoreSolverResult } from '@khora/shared';

export function ScoreSolverPanel({ result, playerId, connected, onClose, onRefresh }: {
  result: ScoreSolverResult | null; playerId: string; connected: boolean; onClose: () => void; onRefresh: () => void;
}) {
  const [showOpponents, setShowOpponents] = useState(false);
  const path = result?.path.filter(move => showOpponents || move.playerId === playerId) ?? [];
  const complete = result?.projectedScore != null && !result.path.length && !result.immediateMove;
  return <aside aria-label="Score solver" className="fixed right-3 top-3 bottom-3 z-50 w-[min(400px,calc(100vw-24px))] rounded-xl border border-sand-300 bg-sand-50 shadow-2xl flex flex-col">
    <header className="p-4 border-b border-sand-200 flex justify-between items-start gap-3">
      <div><h2 className="font-display text-xl text-sand-900">Score solver</h2><p className="text-xs text-sand-600 mt-1">Full information · Maximize your final score</p></div>
      <button type="button" aria-label="Close score solver" onClick={onClose} className="text-sand-700 text-xl px-2">×</button>
    </header>
    <div className="p-4 overflow-y-auto flex-1 space-y-4">
      <div role="status" className="rounded-lg bg-white border border-sand-200 p-4">
        <p className="text-xs uppercase tracking-wide text-sand-600">{!connected ? 'Disconnected' : result?.status === 'SEARCHING' ? 'Searching' : result?.status === 'ERROR' ? 'Analysis unavailable' : result ? 'Search paused' : 'Updating position'}</p>
        <p className="text-base font-semibold text-sand-900 mt-2">{!connected ? 'Reconnect to analyze the current game.' : result?.status === 'ERROR' ? result.message : result?.immediateMove?.instruction ?? (complete ? 'No further moves in this continuation' : result?.path.length ? 'Planning ahead while you wait' : 'Finding a legal recommendation…')}</p>
        {result?.projectedScore != null && <p className="mt-3 text-2xl font-display text-sand-900">{result.projectedScore} <span className="text-sm font-sans text-sand-600">projected final points</span></p>}
        {result && result.status !== 'ERROR' && <p className="text-xs text-sand-600 mt-2">{result.message}</p>}
      </div>
      <p className="text-xs text-sand-600">Opponents are modeled as maximizing their own scores. The path and score depend on their predicted choices and update as the game changes.</p>
      {result?.assumesFutureDraftDraws && <p className="text-xs text-sand-600">Later city offers and draft draws have not been generated yet; this path assumes one possible draw.</p>}
      <div className="flex items-center justify-between gap-2"><h3 className="font-display font-semibold text-sand-900">Projected path</h3>
        <label className="text-xs text-sand-600 flex gap-2 items-center"><input type="checkbox" checked={showOpponents} onChange={e => setShowOpponents(e.target.checked)} />Opponents</label>
      </div>
      {!path.length && !complete && <p className="text-sm text-sand-600">A final score appears once a complete continuation has been evaluated.</p>}
      <ol className="space-y-2">{path.map((move, index) => <li key={index} className="border-l-2 border-sand-300 pl-3 py-1">
        <p className="text-[11px] text-sand-500">Round {move.round} · {move.phase.toLowerCase().replaceAll('_', ' ')}{showOpponents ? ` · ${move.playerName}` : ''}</p>
        <p className="text-sm text-sand-900">{move.instruction}</p>
      </li>)}</ol>
    </div>
    <footer className="p-3 border-t border-sand-200 flex items-center justify-between gap-2">
      <span className="text-xs text-sand-600">{result ? `${result.completedRollouts} full-game trials · ${(result.elapsedMs / 1000).toFixed(1)}s` : 'Waiting for current position'}</span>
      <button type="button" onClick={onRefresh} disabled={!connected} className="text-sm text-sand-900 border border-sand-300 rounded px-3 py-1">Refresh</button>
    </footer>
  </aside>;
}
