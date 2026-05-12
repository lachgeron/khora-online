import React, { useState } from 'react';
import type { CheatControlMode, SolverObjective, SolverResult, RoundPlan, Plan, SolverDisplayMode, DraftPlan, RecommendedMove } from '../types';

export type CoachReadinessStatus = 'THINKING' | 'CHECKING' | 'READY' | 'STALE';
export type CoachConfidence = 'WAIT' | 'GOOD' | 'STRONG' | 'LOCKED';

export interface CoachAdvice {
  status: CoachReadinessStatus;
  confidence: CoachConfidence;
  headline: string;
  detail: string;
  move: RecommendedMove | null;
  canApply: boolean;
}

interface SolverPanelProps {
  result: SolverResult | null;
  stale: boolean;
  objective: SolverObjective;
  onObjectiveChange: (objective: SolverObjective) => void;
  displayMode: SolverDisplayMode;
  onDisplayModeChange: (mode: SolverDisplayMode) => void;
  status: 'stable' | 'rechecking' | 'new-best';
  changeNote: string | null;
  controlMode: CheatControlMode;
  onControlModeChange: (mode: CheatControlMode) => void;
  autopilotLog: string[];
  autopilotPauseReason: string | null;
  coachAdvice: CoachAdvice | null;
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
  objective,
  onObjectiveChange,
  displayMode,
  onDisplayModeChange,
  status,
  changeNote,
  controlMode,
  onControlModeChange,
  autopilotLog,
  autopilotPauseReason,
  coachAdvice,
  onApplyMove,
  onClose,
}) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="fixed top-0 right-0 bottom-0 z-[50] w-[420px] max-w-[92vw] bg-sand-50 border-l border-sand-300 shadow-2xl flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-sand-200 shrink-0 bg-sand-100">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-sand-900">
            Cheat Engine
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
        <button
          onClick={onClose}
          className="text-sand-500 hover:text-sand-800 transition-colors text-xl leading-none"
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      <div className="px-5 py-2 border-b border-sand-200 bg-sand-50 shrink-0">
        <div className="flex items-center gap-1 text-xs text-sand-700" title="Coach shows the recommendation. Auto decision plays one valid pending decision. Auto round keeps playing your valid decisions until the round advances.">
          <span className="mr-1 text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold">Control</span>
          <button
            onClick={() => onControlModeChange('COACH')}
            className={`px-2 py-1 rounded border ${controlMode === 'COACH' ? 'bg-sand-800 text-white border-sand-800' : 'border-sand-300 hover:bg-sand-100'}`}
          >
            Coach
          </button>
          <button
            onClick={() => onControlModeChange('AUTO_DECISION')}
            className={`px-2 py-1 rounded border ${controlMode === 'AUTO_DECISION' ? 'bg-terracotta text-white border-terracotta' : 'border-sand-300 hover:bg-sand-100'}`}
          >
            Auto decision
          </button>
          <button
            onClick={() => onControlModeChange('AUTO_ROUND')}
            className={`px-2 py-1 rounded border ${controlMode === 'AUTO_ROUND' ? 'bg-terracotta text-white border-terracotta' : 'border-sand-300 hover:bg-sand-100'}`}
          >
            Auto round
          </button>
        </div>
        {autopilotPauseReason && controlMode !== 'COACH' && (
          <p className="mt-1 text-[0.65rem] text-amber-700">
            Paused: {autopilotPauseReason}
          </p>
        )}
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
            status={status}
            changeNote={changeNote}
            controlMode={controlMode}
            autopilotLog={autopilotLog}
            coachAdvice={coachAdvice ?? defaultCoachAdvice(result.plan, stale)}
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
  status: 'stable' | 'rechecking' | 'new-best';
  changeNote: string | null;
  controlMode: CheatControlMode;
  autopilotLog: string[];
  coachAdvice: CoachAdvice;
  onApplyMove?: (move: RecommendedMove) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}> = ({ plan, stale, status, changeNote, controlMode, autopilotLog, coachAdvice, onApplyMove, expanded, onToggleExpanded }) => {
  const reasons = reasonChips(plan);
  const analysisLabel = analysisModeLabel(plan.analysisMode);
  const currentInstruction = coachAdvice.move
    ? coachMoveLabel(coachAdvice.move, plan)
    : focusLines(plan)[0] ?? null;
  const isReady = coachAdvice.status === 'READY' && coachAdvice.move !== null && currentInstruction !== null;
  const readinessTitle = isReady
    ? `Do This Now${plan.currentRound ? ` (Round ${plan.currentRound.round})` : ''}`
    : coachAdvice.headline;

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
          <span>Advice: <b>{confidenceLabel(coachAdvice.confidence)}</b></span>
          <span>Search: <b>{analysisLabel}</b></span>
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

      {/* Coach step */}
      {plan.currentRound && (
        <div className={`px-5 py-3 border-b shrink-0 ${coachPanelClass(coachAdvice.status)}`}>
          <p className={`text-[0.65rem] uppercase tracking-wider font-bold mb-1 ${coachTitleClass(coachAdvice.status)}`}>
            {readinessTitle}
          </p>
          {isReady ? (
            <p className="text-sand-900 text-base font-semibold">{currentInstruction}</p>
          ) : (
            <p className="text-sand-800 text-sm font-medium">{coachAdvice.detail}</p>
          )}
          {!isReady && currentInstruction && (
            <p className="mt-1 text-[0.65rem] text-sand-500">
              Likely move: {currentInstruction}
            </p>
          )}
          {isReady && coachAdvice.detail && (
            <p className="mt-1 text-[0.65rem] text-sand-600">{coachAdvice.detail}</p>
          )}
          {isReady && coachAdvice.move && coachAdvice.canApply && onApplyMove && (
            <button
              onClick={() => {
                if (coachAdvice.move) onApplyMove(coachAdvice.move);
              }}
              className="mt-2 px-3 py-1.5 rounded border border-terracotta bg-terracotta text-white text-xs font-semibold hover:bg-terracotta/90 transition-colors"
            >
              Apply next
            </button>
          )}
          {isReady && reasons.length > 0 && (
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
          {isReady && plan.moveAlternatives.length > 1 && (
            <div className="mt-3 border-t border-terracotta/15 pt-2">
              <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold mb-1">
                Alternatives
              </p>
              <ul className="space-y-1">
                {plan.moveAlternatives.slice(1, 4).map((alt) => (
                  <li key={alt.label} className="flex items-center justify-between gap-2 text-[0.7rem] text-sand-700">
                    <span className="truncate" title={alt.label}>{alt.label}</span>
                    <span className="shrink-0 text-sand-500">
                      {formatAlternativeDelta(alt.deltaFromBest)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {isReady && changeNote && (
            <p className="mt-2 text-[0.65rem] text-sand-500">{changeNote}</p>
          )}
          {autopilotLog.length > 0 && (
            <div className="mt-3 border-t border-terracotta/15 pt-2">
              <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold mb-1">
                Autopilot
              </p>
              <ul className="space-y-0.5">
                {autopilotLog.slice(0, 3).map((line) => (
                  <li key={line} className="text-[0.65rem] text-sand-600 truncate" title={line}>{line}</li>
                ))}
              </ul>
            </div>
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
          <span>{controlModeLabel(controlMode)}</span>
          <span>last update {plan.computeMs}ms</span>
          <span>nodes: {plan.exploredNodes.toLocaleString()}</span>
        </div>
        <p className="mt-1">
          {plan.objective === 'WIN_MARGIN' ? winModeCopy(plan.analysisMode) : ''}
          Assumes only known hand cards are playable.
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

function defaultCoachAdvice(plan: Plan, stale: boolean): CoachAdvice {
  const move = firstActionableMove(plan);
  if (stale) {
    return {
      status: 'STALE',
      confidence: 'WAIT',
      headline: 'Hold',
      detail: 'Rechecking the live board.',
      move,
      canApply: false,
    };
  }
  if (plan.partialResult) {
    return {
      status: 'THINKING',
      confidence: 'WAIT',
      headline: 'Hold',
      detail: 'Building the first complete line.',
      move,
      canApply: false,
    };
  }
  const checkingWinLine = plan.objective === 'WIN_MARGIN' && plan.analysisMode !== 'ADVERSARIAL';
  if (checkingWinLine) {
    return {
      status: 'CHECKING',
      confidence: 'WAIT',
      headline: 'Checking Opponents',
      detail: 'Waiting for the opponent search before this becomes a coach move.',
      move,
      canApply: false,
    };
  }
  return {
    status: 'READY',
    confidence: plan.analysisMode === 'ADVERSARIAL' ? 'LOCKED' : plan.analysisMode === 'DEEP' ? 'STRONG' : 'GOOD',
    headline: 'Ready',
    detail: plan.analysisMode === 'ADVERSARIAL' ? 'Opponent lines checked.' : 'Current line is stable.',
    move,
    canApply: move !== null,
  };
}

function analysisModeLabel(mode: Plan['analysisMode']): string {
  if (mode === 'ADVERSARIAL') return 'opponent search';
  if (mode === 'DEEP') return 'deep';
  return 'fast';
}

function confidenceLabel(confidence: CoachConfidence): string {
  if (confidence === 'LOCKED') return 'Locked';
  if (confidence === 'STRONG') return 'Strong';
  if (confidence === 'GOOD') return 'Good';
  return 'Wait';
}

function coachPanelClass(status: CoachReadinessStatus): string {
  if (status === 'READY') return 'bg-emerald-50 border-emerald-200';
  if (status === 'STALE') return 'bg-sand-100 border-sand-200';
  return 'bg-amber-50 border-amber-200';
}

function coachTitleClass(status: CoachReadinessStatus): string {
  if (status === 'READY') return 'text-emerald-700';
  if (status === 'STALE') return 'text-sand-500';
  return 'text-amber-700';
}

function coachMoveLabel(move: RecommendedMove, plan: Plan): string {
  const described = descriptionForMove(move, plan);
  if (move.kind === 'ASSIGN_DICE') {
    const assignments = move.assignments.map(assignment =>
      `${assignment.dieValue} to ${formatName(assignment.action)}`,
    );
    const spend = move.philosophyTokensToSpend && move.philosophyTokensToSpend > 0
      ? `; spend ${move.philosophyTokensToSpend} scroll${move.philosophyTokensToSpend === 1 ? '' : 's'}`
      : '';
    return `Drag ${joinNatural(assignments)}${spend}`;
  }
  if (move.kind === 'PROGRESS_TRACK') {
    if (move.tracks.length === 0) return 'Skip progress';
    const spend = move.philosophySpent > 0
      ? `; spend ${move.philosophySpent} scroll${move.philosophySpent === 1 ? '' : 's'}`
      : '';
    return `Advance ${joinNatural(move.tracks.map(formatName))}${spend}`;
  }
  if (move.kind === 'ACHIEVEMENT_TRACK_CHOICE') {
    const choice = move.choices[0] ?? 'TAX';
    return `Choose +1 ${formatName(choice)}`;
  }
  return described ?? `${formatName(move.actionType)} action`;
}

function descriptionForMove(move: RecommendedMove, plan: Plan): string | null {
  const lines = plan.currentRound?.description ?? [];
  if (move.kind === 'RESOLVE_ACTION') {
    const prefix = formatName(move.actionType);
    return lines.find(line => line.startsWith(prefix)) ?? null;
  }
  if (move.kind === 'PROGRESS_TRACK') {
    return lines.find(line => line.startsWith('Progress:')) ?? null;
  }
  if (move.kind === 'ACHIEVEMENT_TRACK_CHOICE') {
    return lines.find(line => line.startsWith('Achievement:')) ?? null;
  }
  return null;
}

function formatName(name: string): string {
  return name
    .toLowerCase()
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function winModeCopy(mode: Plan['analysisMode']): string {
  if (mode === 'ADVERSARIAL') return 'Win mode has checked searched opponent lines. ';
  if (mode === 'DEEP') return 'Win mode is still checking opponents. ';
  return 'Win mode is still building a reliable line. ';
}

function controlModeLabel(mode: CheatControlMode): string {
  if (mode === 'AUTO_DECISION') return 'auto decision armed';
  if (mode === 'AUTO_ROUND') return 'auto round armed';
  return 'coach';
}

function formatAlternativeDelta(delta: number): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return 'even';
  return `${rounded}`;
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
  if (phase === 'ACHIEVEMENT') return moves.find(m => m.kind === 'ACHIEVEMENT_TRACK_CHOICE') ?? null;
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
