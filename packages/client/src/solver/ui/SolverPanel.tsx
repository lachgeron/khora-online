import React, { useState } from 'react';
import type { SolverObjective, SolverResult, RoundPlan, Plan, SolverDisplayMode, DraftPlan, RecommendedMove } from '../types';

interface SolverPanelProps {
  result: SolverResult | null;
  stale: boolean;
  godMode: boolean;
  onGodModeChange: (enabled: boolean) => void;
  objective: SolverObjective;
  onObjectiveChange: (objective: SolverObjective) => void;
  displayMode: SolverDisplayMode;
  onDisplayModeChange: (mode: SolverDisplayMode) => void;
  status: 'stable' | 'rechecking' | 'new-best';
  changeNote: string | null;
  onApplyMove?: (move: RecommendedMove) => void;
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
export const SolverPanel: React.FC<SolverPanelProps> = ({
  result,
  stale,
  godMode,
  onGodModeChange,
  objective,
  onObjectiveChange,
  displayMode,
  onDisplayModeChange,
  status,
  changeNote,
  onApplyMove,
  onClose,
}) => {
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
        <div className="flex items-center gap-1 text-xs text-sand-700" title="Solver objective">
          <button
            onClick={() => onObjectiveChange('MAX_VP')}
            className={`px-2 py-1 rounded border ${objective === 'MAX_VP' ? 'bg-terracotta text-white border-terracotta' : 'border-sand-300 hover:bg-sand-200'}`}
          >
            Max VP
          </button>
          <button
            onClick={() => onObjectiveChange('WIN_MARGIN')}
            className={`px-2 py-1 rounded border ${objective === 'WIN_MARGIN' ? 'bg-terracotta text-white border-terracotta' : 'border-sand-300 hover:bg-sand-200'}`}
          >
            Win
          </button>
        </div>
        <div className="flex items-center gap-1 text-xs text-sand-700" title="Conservative keeps the visible current move calmer. Aggressive shows every better line immediately.">
          <button
            onClick={() => onDisplayModeChange('CONSERVATIVE')}
            className={`px-2 py-1 rounded border ${displayMode === 'CONSERVATIVE' ? 'bg-sand-700 text-white border-sand-700' : 'border-sand-300 hover:bg-sand-200'}`}
          >
            Calm
          </button>
          <button
            onClick={() => onDisplayModeChange('AGGRESSIVE')}
            className={`px-2 py-1 rounded border ${displayMode === 'AGGRESSIVE' ? 'bg-sand-700 text-white border-sand-700' : 'border-sand-300 hover:bg-sand-200'}`}
          >
            Live
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-sand-700">
          <input
            type="checkbox"
            checked={godMode}
            onChange={(e) => onGodModeChange(e.currentTarget.checked)}
            className="h-3.5 w-3.5 accent-terracotta"
          />
          <span>God-mode</span>
        </label>
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
        ) : 'draft' in result ? (
          <DraftView draft={result.draft} stale={stale} />
        ) : (
          <PlanView
            plan={result.plan}
            stale={stale}
            godMode={godMode}
            status={status}
            changeNote={changeNote}
            onApplyMove={onApplyMove}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((v) => !v)}
          />
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

const DraftView: React.FC<{ draft: DraftPlan; stale: boolean }> = ({ draft, stale }) => {
  const verb = draft.action === 'BAN' ? 'Ban' : 'Pick';
  const top = draft.recommendations[0] ?? null;

  return (
    <div className={`flex flex-col h-full transition-opacity duration-200 ${stale ? 'opacity-50' : 'opacity-100'}`}>
      <div className="px-5 py-4 bg-sand-100 border-b border-sand-200 shrink-0 relative">
        {stale && (
          <div className="absolute top-2 right-2 w-4 h-4 border-2 border-sand-300 border-t-terracotta rounded-full animate-spin" aria-label="Recomputing" />
        )}
        <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold">
          {draft.phaseLabel}
        </p>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="font-display text-4xl font-bold text-terracotta leading-none">
            {top ? Math.round(top.score) : '-'}
          </span>
          <span className="text-sand-600 text-xs uppercase tracking-wider">draft score</span>
        </div>
        <p className="mt-2 text-[0.7rem] text-sand-600">
          {draft.draftedCards.length} card{draft.draftedCards.length === 1 ? '' : 's'} already drafted
        </p>
      </div>

      <div className="px-5 py-3 bg-terracotta/5 border-b border-terracotta/20 shrink-0">
        <p className="text-[0.65rem] uppercase tracking-wider text-terracotta font-bold mb-1">
          {draft.isMyTurn ? `${verb} This` : `Best ${verb}`}
        </p>
        <p className="text-sand-800 text-sm font-medium">
          {top ? `${verb} ${top.cardName}` : 'No card available'}
        </p>
        {!draft.isMyTurn && (
          <p className="mt-1 text-[0.65rem] text-sand-500">
            Waiting for your turn; keep this queued as the current best choice.
          </p>
        )}
        {top && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {top.reasons.map((reason) => (
              <span
                key={reason}
                className="px-1.5 py-0.5 rounded border border-terracotta/20 bg-white text-[0.65rem] text-sand-700"
              >
                {reason}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3">
        <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold mb-2">
          Ranked Cards
        </p>
        {draft.recommendations.length === 0 ? (
          <p className="text-xs text-sand-500 italic">No cards to rank yet.</p>
        ) : (
          <ol className="space-y-2">
            {draft.recommendations.map((card, index) => (
              <li key={card.cardId} className="border border-sand-200 bg-sand-50 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-sand-800">
                      {index + 1}. {card.cardName}
                    </p>
                    <p className="text-[0.65rem] uppercase tracking-wider text-sand-500">
                      {card.type.replace('_', ' ')}{card.cost > 0 ? ` · ${card.cost} coins` : ' · free'}
                    </p>
                  </div>
                  <span className="font-display text-lg text-terracotta">{card.score}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {card.reasons.map((reason) => (
                    <span
                      key={reason}
                      className="px-1.5 py-0.5 rounded border border-sand-200 bg-white text-[0.65rem] text-sand-600"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="px-5 py-2 border-t border-sand-200 text-[0.65rem] text-sand-500 shrink-0 mt-auto">
        draft analysis {draft.computeMs}ms
      </div>
    </div>
  );
};

const PlanView: React.FC<{
  plan: Plan;
  stale: boolean;
  godMode: boolean;
  status: 'stable' | 'rechecking' | 'new-best';
  changeNote: string | null;
  onApplyMove?: (move: RecommendedMove) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}> = ({ plan, stale, godMode, status, changeNote, onApplyMove, expanded, onToggleExpanded }) => {
  const nowLines = focusLines(plan);
  const bestMove = nowLines[0] ?? plan.currentRound?.description?.[0] ?? null;
  const reasons = reasonChips(plan);
  const actionableMove = firstActionableMove(plan);

  return (
    <div className={`flex flex-col h-full transition-opacity duration-200 ${stale ? 'opacity-50' : 'opacity-100'}`}>
      {/* Eval bar: projected final VP */}
      <div className="px-5 py-4 bg-sand-100 border-b border-sand-200 shrink-0 relative">
        {stale && (
          <div className="absolute top-2 right-2 w-4 h-4 border-2 border-sand-300 border-t-terracotta rounded-full animate-spin" aria-label="Recomputing" />
        )}
        <div className="absolute top-2 right-8 text-[0.65rem] uppercase tracking-wider text-sand-500">
          {statusLabel(status, stale)}
        </div>
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
        {plan.objective === 'WIN_MARGIN' && plan.projectedWinMargin !== null && (
          <div className="mt-2 text-[0.7rem] text-sand-700 flex flex-wrap gap-x-3">
            <span>Margin: <b>{formatSigned(plan.projectedWinMargin)}</b></span>
            <span>Strongest opponent: <b>{Math.round(plan.strongestOpponentVP ?? 0)}</b></span>
          </div>
        )}
      </div>

      {/* Best next move */}
      {bestMove && plan.currentRound && (
        <div className="px-5 py-3 bg-terracotta/5 border-b border-terracotta/20 shrink-0">
          <p className="text-[0.65rem] uppercase tracking-wider text-terracotta font-bold mb-1">
            Do This Now (Round {plan.currentRound.round})
          </p>
          <p className="text-sand-800 text-sm font-medium">{bestMove}</p>
          {actionableMove && onApplyMove && (
            <button
              onClick={() => onApplyMove(actionableMove)}
              className="mt-2 px-3 py-1.5 rounded border border-terracotta bg-terracotta text-white text-xs font-semibold hover:bg-terracotta/90 transition-colors"
            >
              Apply
            </button>
          )}
          {nowLines.length > 1 && (
            <ul className="mt-2 list-disc list-inside space-y-0.5 text-xs text-sand-700">
              {nowLines.slice(1).map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          {reasons.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {reasons.map((reason) => (
                <span
                  key={reason.label}
                  title={reason.title}
                  className="px-1.5 py-0.5 rounded border border-terracotta/20 bg-white text-[0.65rem] text-sand-700"
                >
                  {reason.label}
                </span>
              ))}
            </div>
          )}
          {changeNote && (
            <p className="mt-2 text-[0.65rem] text-sand-500">{changeNote}</p>
          )}
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
              <RoundBody round={plan.currentRound} phase={plan.currentPhase} />
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
      <div className="px-5 py-2 border-t border-sand-200 text-[0.65rem] text-sand-500 shrink-0 mt-auto">
        <div className="flex gap-3">
          <span>last update {plan.computeMs}ms</span>
          <span>nodes: {plan.exploredNodes.toLocaleString()}</span>
        </div>
        <p className="mt-1">
          {plan.objective === 'WIN_MARGIN' ? 'Win mode ranks by estimated margin over the strongest opponent. ' : ''}
          Assumes {godMode ? 'deck cards are swappable.' : 'only known hand cards are playable.'}
        </p>
      </div>
    </div>
  );
};

const RoundBody: React.FC<{ round: RoundPlan; phase?: Plan['currentPhase'] }> = ({ round, phase }) => (
  <div>
    <ul className="list-disc list-inside space-y-0.5 text-sm text-sand-800">
      {(phase ? focusDescription(round.description, phase) : round.description).map((line, i) => (
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

function statusLabel(status: 'stable' | 'rechecking' | 'new-best', stale: boolean): string {
  if (stale || status === 'rechecking') return 'rechecking';
  if (status === 'new-best') return 'new best';
  return 'stable';
}

function focusLines(plan: Plan): string[] {
  if (!plan.currentRound) return [];
  return focusDescription(plan.currentRound.description, plan.currentPhase);
}

function firstActionableMove(plan: Plan): RecommendedMove | null {
  const phase = plan.currentPhase;
  const moves = plan.currentRound?.recommendedMoves ?? [];
  if (phase === 'DICE') return moves.find(m => m.kind === 'ASSIGN_DICE') ?? null;
  if (phase === 'ACTIONS') return moves.find(m => m.kind === 'RESOLVE_ACTION') ?? null;
  if (phase === 'PROGRESS') return moves.find(m => m.kind === 'PROGRESS_TRACK') ?? null;
  return null;
}

function focusDescription(lines: string[], phase: Plan['currentPhase']): string[] {
  const primary =
    phase === 'DICE' ? lines.filter(line => line.startsWith('Dice:') || isActionLine(line)) :
    phase === 'ACTIONS' ? lines.filter(isActionLine) :
    phase === 'PROGRESS' ? lines.filter(line => line.startsWith('Progress:')) :
    phase === 'GLORY' ? lines.filter(line => line.startsWith('Event:')) :
    phase === 'ACHIEVEMENT' ? lines.filter(line => line.startsWith('Achievement:')) :
    lines;

  const mustShow = lines.filter(isAlwaysVisibleDecisionLine);
  return uniqueLines([...primary, ...mustShow]);
}

function isActionLine(line: string): boolean {
  return ['Philosophy', 'Legislation', 'Culture', 'Trade', 'Military', 'Politics', 'Development', 'Thebes dev 2']
    .some(prefix => line.startsWith(prefix));
}

function isAlwaysVisibleDecisionLine(line: string): boolean {
  return line.startsWith('Progress:')
    || line.startsWith('Achievement:')
    || line.includes('Oracle of Delphi:');
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

function reasonChips(plan: Plan): Array<{ label: string; title: string }> {
  const lines = [
    ...(plan.currentRound?.description ?? []),
    ...plan.futureRounds.slice(0, 2).flatMap(r => r.description),
  ];
  const chips: Array<{ label: string; title: string }> = [];
  const add = (label: string, title: string) => {
    if (!chips.some(c => c.label === label)) chips.push({ label, title });
  };
  for (const line of lines) {
    if (line.includes('Event:')) add('event', 'The line accounts for upcoming event resolution.');
    if (line.includes('Achievement:')) add('achievement', 'The line claims or preserves an achievement reward.');
    if (line.includes('Development')) add('dev setup', 'Development value is part of this line.');
    if (line.includes('Major') || line.includes('Persepolis')) add('major tokens', 'Major tokens increase Glory end-game scoring.');
    if (line.includes('Politics')) add('card timing', 'Card timing affects immediate and end-game scoring.');
    if (line.startsWith('Dice:')) add('citizens checked', 'Dice and citizen costs are included in the plan.');
  }
  return chips.slice(0, 5);
}

function formatSigned(n: number): string {
  const rounded = Math.round(n);
  return rounded > 0 ? `+${rounded}` : String(rounded);
}
