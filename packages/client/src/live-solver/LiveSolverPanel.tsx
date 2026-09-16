import React from 'react';
import type { DecisionType, GamePhase, LiveSolverMove, LiveSolverResult, LiveSolverRoundPlan } from '../types';

interface LiveSolverPanelProps {
  pending: boolean;
  result: LiveSolverResult | null;
  currentRound: number | null;
  currentPhase: GamePhase | null;
  currentDecisionType: DecisionType | null;
  onRefresh: () => void;
  onClose: () => void;
}

export const LiveSolverPanel: React.FC<LiveSolverPanelProps> = ({
  pending,
  result,
  currentRound,
  currentPhase,
  currentDecisionType,
  onRefresh,
  onClose,
}) => {
  const moveCursor = getMoveCursor(result, currentRound, currentPhase, currentDecisionType);
  const currentMove = moveCursor.currentMove;
  const upcomingMoves = moveCursor.upcomingMoves;
  const visibleRounds = getVisibleRounds(result, currentRound, currentPhase, currentDecisionType, currentMove);
  const lineWarning = getLineWarning(
    result,
    currentMove,
    visibleRounds,
    currentRound,
    currentPhase,
    currentDecisionType,
  );
  const leader = result?.projections[0] ?? null;
  const ownProjection = result?.projections.find(score => score.playerId === result.playerId) ?? null;
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
              {pending && result?.status === 'READY'
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
        {lineWarning && (
          <div className="mb-3 rounded border border-terracotta/30 bg-terracotta/10 px-3 py-2">
            <p className="text-[0.72rem] font-semibold text-terracotta">{lineWarning}</p>
          </div>
        )}
        {!result ? (
          <p className="text-sm text-sand-500">Waiting for the first search result.</p>
        ) : result.status !== 'READY' ? (
          <p className="text-sm text-sand-700">{result.message}</p>
        ) : currentMove ? (
          <>
            <MoveCallout move={currentMove} />
            <UpcomingMoves moves={upcomingMoves} />
          </>
        ) : (
          <>
            <p className="text-sm text-sand-500">No player decision is needed right now.</p>
            <UpcomingMoves moves={upcomingMoves} />
          </>
        )}
      </div>

      {result && result.status === 'READY' && (
        <div className="px-5 py-3 border-b border-sand-200 bg-sand-50 shrink-0">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold">Projection</p>
              <p className="font-display text-3xl font-bold text-terracotta leading-none mt-1">
                {ownProjection ? ownProjection.projectedTotal : '-'}
              </p>
              <p className="text-[0.7rem] text-sand-500 mt-1">
                projected VP
              </p>
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
            {result.verifiedFinalScore !== undefined && (
              <p className="text-xs text-sand-700 mt-1">Full line replay checked: {result.verifiedFinalScore} VP under the modeled opponent choices.</p>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold mb-2">Remaining Path</p>
        {!result || result.rounds.length === 0 ? (
          <p className="text-xs text-sand-500 italic">The best line found so far will appear as soon as the search has one.</p>
        ) : visibleRounds.length === 0 ? (
          <p className="text-xs text-sand-500 italic">No remaining steps match the current game state. Refresh the solver before following this line.</p>
        ) : (
          <div className="space-y-4">
            {visibleRounds.map(round => (
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
    <MoveHelp move={move} />
  </div>
);

const MoveHelp: React.FC<{ move: LiveSolverMove }> = ({ move }) => {
  const notes = guidanceNotes(move);
  if (notes.length === 0) return null;

  return (
    <div className="mt-3 rounded border border-sand-200 bg-sand-50 px-3 py-2">
      {notes.map((note, index) => (
        <p key={index} className="text-[0.7rem] text-sand-600 leading-snug">
          {note}
        </p>
      ))}
    </div>
  );
};

const UpcomingMoves: React.FC<{ moves: LiveSolverMove[] }> = ({ moves }) => {
  if (moves.length === 0) return null;

  return (
    <div className="mt-3 border-t border-sand-200 pt-3">
      <p className="text-[0.65rem] uppercase tracking-wider text-sand-500 font-bold mb-1.5">Next Up</p>
      <ol className="space-y-1.5">
        {moves.map((move, index) => (
          <li key={`${move.round}-${move.phase}-${move.instruction}-${index}`} className="flex gap-2 text-xs">
            <span className="shrink-0 text-sand-400 font-semibold">{index + 1}.</span>
            <span className="min-w-0">
              <span className="font-semibold text-sand-800">{move.instruction}</span>
              <span className="text-sand-500"> · {phaseLabel(move.phase)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

const PHASE_ORDER: GamePhase[] = [
  'OMEN',
  'TAXATION',
  'DICE',
  'ACTIONS',
  'PROGRESS',
  'GLORY',
  'ACHIEVEMENT',
  'GAME_OVER',
];

const DECISION_ORDER_BY_PHASE: Partial<Record<GamePhase, DecisionType[]>> = {
  DICE: ['ROLL_DICE', 'ASSIGN_DICE'],
  ACTIONS: ['RESOLVE_ACTION'],
  PROGRESS: ['PROGRESS_TRACK'],
  GLORY: [
    'PROSPERITY_POLITICS',
    'ORACLE_CHOOSE_TOKEN',
    'MILITARY_VICTORY_PROGRESS',
    'RISE_OF_PERSIA_PROGRESS',
    'THIRTY_TYRANTS_DISCARD',
    'CONQUEST_ACTION',
  ],
  ACHIEVEMENT: ['ACHIEVEMENT_TRACK_CHOICE'],
};

function getMoveCursor(
  result: LiveSolverResult | null,
  currentRound: number | null,
  currentPhase: GamePhase | null,
  currentDecisionType: DecisionType | null,
): { currentMove: LiveSolverMove | null; upcomingMoves: LiveSolverMove[] } {
  if (!result || result.status !== 'READY') return { currentMove: null, upcomingMoves: [] };

  const moves = result.rounds.flatMap(round => round.moves);
  if (moves.length === 0) return { currentMove: result.currentMove, upcomingMoves: [] };

  const targetMove = findCurrentMove(moves, result.playerId, currentRound, currentPhase, currentDecisionType)
    ?? fallbackCurrentMove(result.currentMove, currentRound, currentPhase, currentDecisionType);
  const targetIndex = targetMove
    ? moves.findIndex(move => sameMove(move, targetMove))
    : -1;
  const startIndex = targetIndex >= 0
    ? targetIndex + (targetMove ? 1 : 0)
    : firstFutureMoveIndex(moves, currentRound, currentPhase, currentDecisionType);

  return {
    currentMove: targetMove,
    upcomingMoves: moves.slice(Math.max(0, startIndex), Math.max(0, startIndex) + 3),
  };
}

function getVisibleRounds(
  result: LiveSolverResult | null,
  currentRound: number | null,
  currentPhase: GamePhase | null,
  currentDecisionType: DecisionType | null,
  currentMove: LiveSolverMove | null,
): LiveSolverRoundPlan[] {
  if (!result || result.status !== 'READY') return [];
  if (currentRound === null || currentPhase === null) return result.rounds;

  const moves = result.rounds.flatMap(round => round.moves);
  const currentIndex = currentMove
    ? moves.findIndex(move => sameMove(move, currentMove))
    : -1;
  const startIndex = currentIndex >= 0
    ? currentIndex
    : firstFutureMoveIndex(moves, currentRound, currentPhase, currentDecisionType);
  const remainingMoves = new Set(moves.slice(startIndex));

  return result.rounds
    .map(round => ({
      ...round,
      moves: round.moves.filter(move => remainingMoves.has(move)),
    }))
    .filter(round => round.moves.length > 0);
}

function getLineWarning(
  result: LiveSolverResult | null,
  currentMove: LiveSolverMove | null,
  visibleRounds: LiveSolverRoundPlan[],
  currentRound: number | null,
  currentPhase: GamePhase | null,
  currentDecisionType: DecisionType | null,
): string | null {
  if (!result || result.status !== 'READY' || currentRound === null || currentPhase === null) return null;
  if (result.rounds.length === 0) return null;
  if (currentPhase === 'GAME_OVER') return null;

  if (currentDecisionType && !currentMove) {
    return 'This line no longer matches the current decision. Refresh before following it.';
  }

  if (visibleRounds.length === 0) {
    return 'This line appears to be behind the current board state. Refresh to realign it.';
  }

  const firstVisibleMove = visibleRounds[0]?.moves[0] ?? null;
  if (
    firstVisibleMove
    && currentDecisionType
    && compareMoveTime(firstVisibleMove.round, firstVisibleMove.phase, currentRound, currentPhase) > 0
  ) {
    return 'The next saved step is later than the current decision. Refresh before acting.';
  }

  return null;
}

function findCurrentMove(
  moves: LiveSolverMove[],
  playerId: string,
  currentRound: number | null,
  currentPhase: GamePhase | null,
  currentDecisionType: DecisionType | null,
): LiveSolverMove | null {
  if (currentRound === null || currentPhase === null) return null;

  if (currentDecisionType) {
    return moves.find(move =>
      move.playerId === playerId
      && move.round === currentRound
      && move.phase === currentPhase
      && decisionMatches(move.decisionType, currentDecisionType)) ?? null;
  }

  return moves.find(move =>
    move.playerId === playerId
    && move.decisionType === 'ACTIVATE_DEV'
    && compareMoveTime(move.round, move.phase, currentRound, currentPhase) >= 0) ?? null;
}

function fallbackCurrentMove(
  move: LiveSolverMove | null,
  currentRound: number | null,
  currentPhase: GamePhase | null,
  currentDecisionType: DecisionType | null,
): LiveSolverMove | null {
  if (!move || currentRound === null || currentPhase === null) return move;
  if (move.round !== currentRound || move.phase !== currentPhase) return null;
  if (!currentDecisionType) return move.decisionType === 'ACTIVATE_DEV' ? move : null;
  return decisionMatches(move.decisionType, currentDecisionType) ? move : null;
}

function firstFutureMoveIndex(
  moves: LiveSolverMove[],
  currentRound: number | null,
  currentPhase: GamePhase | null,
  currentDecisionType: DecisionType | null,
): number {
  if (currentRound === null || currentPhase === null) return 0;
  const index = moves.findIndex(move => isMoveAtOrAfterDecision(move, currentRound, currentPhase, currentDecisionType));
  return index >= 0 ? index : moves.length;
}

function isMoveAtOrAfterDecision(
  move: LiveSolverMove,
  currentRound: number,
  currentPhase: GamePhase,
  currentDecisionType: DecisionType | null,
): boolean {
  const timeCompare = compareMoveTime(move.round, move.phase, currentRound, currentPhase);
  if (timeCompare > 0) return true;
  if (timeCompare < 0) return false;
  if (!currentDecisionType) return true;
  return compareDecisionOrder(move.decisionType, currentDecisionType, currentPhase) >= 0;
}

function compareDecisionOrder(
  moveDecisionType: LiveSolverMove['decisionType'],
  currentDecisionType: DecisionType,
  phase: GamePhase,
): number {
  if (decisionMatches(moveDecisionType, currentDecisionType)) return 0;
  const order = DECISION_ORDER_BY_PHASE[phase] ?? [];
  const moveIndex = decisionOrderIndex(order, moveDecisionType);
  const currentIndex = decisionOrderIndex(order, currentDecisionType);
  if (moveIndex !== currentIndex) return moveIndex - currentIndex;
  return moveDecisionType.localeCompare(currentDecisionType);
}

function decisionOrderIndex(order: DecisionType[], decisionType: LiveSolverMove['decisionType'] | DecisionType): number {
  if (decisionType === 'ACTIVATE_DEV') return order.length;
  const directIndex = order.indexOf(decisionType);
  if (directIndex >= 0) return directIndex;
  const normalized = normalizeDecisionType(decisionType);
  if (normalized === 'ACTIVATE_DEV') return order.length;
  const normalizedIndex = order.indexOf(normalized);
  return normalizedIndex >= 0 ? normalizedIndex : order.length;
}

function decisionMatches(moveDecisionType: LiveSolverMove['decisionType'], currentDecisionType: DecisionType): boolean {
  return moveDecisionType === currentDecisionType
    || normalizeDecisionType(moveDecisionType) === normalizeDecisionType(currentDecisionType);
}

function normalizeDecisionType(decisionType: LiveSolverMove['decisionType'] | DecisionType): LiveSolverMove['decisionType'] | DecisionType {
  switch (decisionType) {
    case 'SPEND_PHILOSOPHY_TOKENS':
      return 'ASSIGN_DICE';
    case 'CHOOSE_LEGISLATION_CARD':
    case 'CHOOSE_TRADE_BUY':
    case 'CHOOSE_EXPLORATION':
    case 'CHOOSE_POLITICS_CARD':
    case 'CHOOSE_DEVELOPMENT':
      return 'RESOLVE_ACTION';
    default:
      return decisionType;
  }
}

function compareMoveTime(leftRound: number, leftPhase: GamePhase, rightRound: number, rightPhase: GamePhase): number {
  if (leftRound !== rightRound) return leftRound - rightRound;
  return PHASE_ORDER.indexOf(leftPhase) - PHASE_ORDER.indexOf(rightPhase);
}

function sameMove(left: LiveSolverMove, right: LiveSolverMove): boolean {
  return left.round === right.round
    && left.phase === right.phase
    && left.playerId === right.playerId
    && left.decisionType === right.decisionType
    && left.instruction === right.instruction;
}

function guidanceNotes(move: LiveSolverMove): string[] {
  const message = move.message;
  if (!message) return [];

  if (message.type === 'ASSIGN_DICE') {
    const actions = message.assignments.map(assignment => assignment.actionType);
    const notes = [`Set these dice first; the later steps assume ${joinNatural(actions.map(formatAction))}.`];
    if (message.philosophyTokensToSpend) notes.push(`Spend ${message.philosophyTokensToSpend} scroll${message.philosophyTokensToSpend === 1 ? '' : 's'} before assigning.`);
    return notes;
  }

  if (message.type === 'RESOLVE_ACTION') {
    if (message.actionType === 'TRADE' && message.choices.buyMinorKnowledge) {
      return [`Buy ${message.choices.minorKnowledgeColor?.toLowerCase() ?? 'the specified'} knowledge. Later steps depend on this color.`];
    }
    if (message.actionType === 'MILITARY' && message.choices.explorationTokenId) {
      return ['Match the troop requirement, skulls, and rewards. If that token is gone, wait for updated advice before committing.'];
    }
    if (message.actionType === 'POLITICS' && message.choices.targetCardId) {
      return ['If payment or knowledge is short, take the strongest resource action available and refresh before spending scrolls elsewhere.'];
    }
    if (message.actionType === 'DEVELOPMENT') {
      return ['This is usually a line-critical unlock; if requirements fail, prioritize the missing knowledge color or drachma immediately.'];
    }
  }

  if (message.type === 'PROGRESS_TRACK') {
    const tracks = [
      message.advancement.track,
      ...(message.extraTracks ?? []).map(track => track.track),
      ...(message.bonusTracks ?? []).map(track => track.track),
    ];
    return [`Track priority: ${joinNatural(tracks.map(formatAction))}. If you cannot afford all of it, take the first listed track and refresh.`];
  }

  if (message.type === 'CLAIM_ACHIEVEMENT') {
    return [`Take ${message.trackChoice === 'TAX' ? 'Tax' : 'Glory'} unless another player can claim this achievement before your next turn.`];
  }

  return [];
}

function formatAction(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ');
}

function joinNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

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
