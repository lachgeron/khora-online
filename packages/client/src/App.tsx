import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { ACTION_NUMBERS } from './types';
import type {
  PlayerInfo,
  DiceAssignment,
  TrackAdvancement,
  ActionType,
  ActionChoices,
  DraftMode,
  ClientMessage,
  PublicGameState,
  PrivatePlayerState,
  PublicPlayerState,
  PoliticsCard,
  KnowledgeToken,
  ProgressTrackType,
  KnowledgeColor,
} from './types';
import { createLobby, joinLobby, reconnectGame, startGame, updateLobbySettings } from './api';
import { useGameSocket } from './useGameSocket';
import { useLobbyPolling } from './useLobbyPolling';
import { GameBrowser } from './components/GameBrowser';
import { LobbyRoom } from './components/LobbyRoom';
import { CitySelection } from './components/CitySelection';
import { PoliticsDraft } from './components/PoliticsDraft';
import { PickBanDraft } from './components/PickBanDraft';
import { GameBoard } from './components/GameBoard';
import { DicePhase } from './components/DicePhase';
import { ActionPhase } from './components/ActionPhase';
import { ActionOverview } from './components/ActionOverview';
import { WaitingPanel } from './components/WaitingPanel';
import { ProgressPhase } from './components/ProgressPhase';
import { AchievementPhase } from './components/AchievementPhase';
import { GloryEventPanel } from './components/GloryEventPanel';
import { StandingsRecap } from './components/StandingsRecap';
import { GameSummary } from './components/GameSummary';
import { CardPlayAnnouncement } from './components/CardPlayAnnouncement';
import { AdminSwapModal } from './components/AdminSwapModal';
import { AdminEventModal } from './components/AdminEventModal';
import { useAdminMode } from './useAdminMode';
import { StatsPage } from './components/StatsPage';
import { SolverPanel } from './solver/ui/SolverPanel';
import { useSolverKeybind } from './solver/ui/useSolverKeybind';
import { useSolverMode } from './solver/useSolverMode';
import type { CheatControlMode, Plan, RecommendedMove, SolverResult } from './solver/types';

type Screen = 'NAME' | 'BROWSE' | 'LOBBY' | 'GAME' | 'STATS';

const PLAYER_NAMES = ['Pete', 'Ian', 'LachG', 'LJC'] as const;
const TIME_BANK_DANGER_SECONDS = 10;
const CHEAT_LOG_LIMIT = 6;
const AUTOPILOT_MIN_SOLVER_MS = 1000;

interface TimeBankDangerOverlayProps {
  active: boolean;
  remainingSeconds: number;
}

const TimeBankDangerOverlay: React.FC<TimeBankDangerOverlayProps> = ({ active, remainingSeconds }) => {
  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[1000] pointer-events-none time-bank-danger-flash" aria-live="assertive">
      <div className="absolute inset-x-0 top-4 flex justify-center px-4">
        <div className="rounded-lg border-2 border-red-200 bg-red-700 px-6 py-4 text-center text-white shadow-2xl time-bank-danger-card">
          <p className="text-xs font-bold uppercase tracking-[0.18em]">Time Bank Critical</p>
          <p className="font-display text-4xl font-bold leading-none mt-1">{remainingSeconds}s</p>
          <p className="text-sm font-semibold mt-1">Move now or you will flag.</p>
        </div>
      </div>
    </div>
  );
};

interface CheatCommand {
  message: ClientMessage;
  label: string;
  pendingKey: string;
  signature: string;
}

interface DirectActionCommand {
  message: ClientMessage;
  label: string;
  score: number;
}

const PROGRESS_COSTS: Record<ProgressTrackType, Record<number, number>> = {
  ECONOMY: { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 },
  CULTURE: { 1: 1, 2: 4, 3: 6, 4: 6, 5: 7, 6: 7 },
  MILITARY: { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9 },
};

const AUTOPILOT_CARD_VALUE: Record<string, number> = {
  'central-government': 120,
  diversification: 112,
  'gold-reserve': 106,
  'public-market': 96,
  taxation: 94,
  philosophy: 90,
  'extraordinary-collection': 88,
  'corinthian-columns': 84,
  'constructing-the-mint': 82,
  gradualism: 80,
  'old-guard': 78,
  'scholarly-welcome': 76,
  council: 74,
  'greek-fire': 72,
  socrates: 70,
};

function solverPlanFromResult(result: SolverResult | null): Plan | null {
  return result && result.ok && 'plan' in result ? result.plan : null;
}

function cheatMovesForPhase(plan: Plan, phase: PublicGameState['currentPhase']): RecommendedMove[] {
  const moves = plan.currentRound?.recommendedMoves ?? [];
  if (phase === 'DICE') return moves.filter(m => m.kind === 'ASSIGN_DICE');
  if (phase === 'ACTIONS') return moves.filter(m => m.kind === 'RESOLVE_ACTION');
  if (phase === 'PROGRESS') return moves.filter(m => m.kind === 'PROGRESS_TRACK');
  if (phase === 'ACHIEVEMENT') return moves.filter(m => m.kind === 'ACHIEVEMENT_TRACK_CHOICE');
  return [];
}

function currentPendingDecision(gameState: PublicGameState, currentPlayerId: string) {
  return gameState.pendingDecisions.find(d =>
    d.playerId === currentPlayerId && d.decisionType !== 'PHASE_DISPLAY',
  ) ?? null;
}

function makeCheatCommand(
  pending: NonNullable<ReturnType<typeof currentPendingDecision>>,
  message: ClientMessage,
  label: string,
): CheatCommand {
  return {
    message,
    label,
    pendingKey: `${pending.decisionType}:${pending.timeoutAt}`,
    signature: JSON.stringify(message),
  };
}

function directCommandToCheatCommand(
  pending: NonNullable<ReturnType<typeof currentPendingDecision>>,
  command: DirectActionCommand,
): CheatCommand {
  return makeCheatCommand(pending, command.message, command.label);
}

function nextResolvableAction(slots: PrivatePlayerState['actionSlots']): ActionType | null {
  return slots
    .filter((slot): slot is NonNullable<typeof slot> => slot !== null && !slot.resolved)
    .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType])[0]?.actionType ?? null;
}

function actionCanBeSkipped(action: ActionType): boolean {
  return action === 'LEGISLATION' || action === 'POLITICS' || action === 'DEVELOPMENT';
}

function solverActionChoicesAreLive(
  actionType: ActionType,
  choices: ActionChoices,
  gameState: PublicGameState,
  privateState: PrivatePlayerState,
  currentPlayerId: string,
): boolean {
  if (actionType === 'POLITICS') {
    if (!choices.targetCardId) return false;
    const card = privateState.handCards.find(candidate => candidate.id === choices.targetCardId);
    if (!card) return false;
    if (privateState.coins < card.cost) return false;
    const philosophyPairs = choices.philosophyPairsToUse ?? 0;
    const shortfall = knowledgeShortfall(card, privateState.knowledgeTokens);
    if (philosophyPairs < shortfall || philosophyPairs * 2 > privateState.philosophyTokens) return false;
    if (card.id === 'scholarly-welcome' && !choices.scholarlyWelcomeColor) return false;
    if (card.id === 'ostracism') {
      if (!choices.ostracismReturnCardId) return false;
      if (!privateState.playedCards.some(played => played.id === choices.ostracismReturnCardId)) return false;
    }
    return choices.ostracismReturnCardId === undefined
      || privateState.playedCards.some(played => played.id === choices.ostracismReturnCardId);
  }
  if (actionType === 'LEGISLATION' && choices.targetCardId) {
    const legalDraw = privateState.legislationDraw?.length
      ? privateState.legislationDraw
      : (privateState.solverFullState?.politicsDeck.slice(0, 2) ?? []);
    return legalDraw.some(card => card.id === choices.targetCardId);
  }
  if (actionType === 'MILITARY') {
    const me = gameState.players.find(player => player.playerId === currentPlayerId);
    if (!me) return false;
    return [choices.explorationTokenId, choices.secondExplorationTokenId]
      .filter((id): id is string => Boolean(id))
      .every(id => {
        const token = gameState.centralBoardTokens.find(candidate => candidate.id === id);
        return token !== undefined && !token.explored && (token.militaryRequirement ?? 99) <= me.troopTrack + me.militaryTrack;
      });
  }
  if (actionType === 'TRADE' && choices.buyMinorKnowledge) {
    const me = gameState.players.find(player => player.playerId === currentPlayerId);
    if (!me || !choices.minorKnowledgeColor) return false;
    const tokenCost = hasPlayedCard(privateState, 'corinthian-columns') ? 3 : 5;
    return privateState.coins + me.economyTrack + 1 >= tokenCost;
  }
  if (actionType === 'DEVELOPMENT') {
    const me = gameState.players.find(player => player.playerId === currentPlayerId);
    if (!me) return false;
    const development = nextDevelopmentForPlayer(gameState, me);
    if (!development) return false;
    const philosophyPairs = choices.philosophyPairsToUse ?? 0;
    const shortfall = requirementShortfall(development.knowledgeRequirement, privateState.knowledgeTokens);
    return philosophyPairs >= shortfall
      && philosophyPairs * 2 <= privateState.philosophyTokens
      && development.drachmaCost <= privateState.coins;
  }
  return true;
}

function currentRoundPlanIsExecutable(
  plan: Plan,
  gameState: PublicGameState,
  privateState: PrivatePlayerState,
  currentPlayerId: string,
): boolean {
  const virtualHand = new Set(privateState.handCards.map(card => card.id));
  const legalDraw = privateState.legislationDraw?.length
    ? privateState.legislationDraw
    : (privateState.solverFullState?.politicsDeck.slice(0, 2) ?? []);

  for (const move of plan.currentRound?.recommendedMoves ?? []) {
    if (move.kind !== 'RESOLVE_ACTION') continue;
    if (move.actionType === 'LEGISLATION' && move.choices.targetCardId) {
      if (!legalDraw.some(card => card.id === move.choices.targetCardId)) return false;
      virtualHand.add(move.choices.targetCardId);
      continue;
    }
    if (move.actionType === 'POLITICS') {
      if (!move.choices.targetCardId) return false;
      if (!virtualHand.has(move.choices.targetCardId)) return false;
      if (move.choices.ostracismReturnCardId !== undefined
        && !privateState.playedCards.some(card => card.id === move.choices.ostracismReturnCardId)) {
        return false;
      }
      virtualHand.delete(move.choices.targetCardId);
      if (move.choices.ostracismReturnCardId) virtualHand.add(move.choices.ostracismReturnCardId);
      continue;
    }
    if (move.actionType === 'MILITARY'
      && !solverActionChoicesAreLive(move.actionType as ActionType, move.choices, gameState, privateState, currentPlayerId)) {
      return false;
    }
  }
  return true;
}

function solverProgressMoveIsLive(
  move: Extract<RecommendedMove, { kind: 'PROGRESS_TRACK' }>,
  player: PublicPlayerState,
  privateState: PrivatePlayerState,
): boolean {
  const [first, ...rest] = move.tracks;
  if (!first) return true;
  let shadow: PublicPlayerState = { ...player, coins: privateState.coins };
  let philosophyTokens = privateState.philosophyTokens;
  const extraCount = Math.max(0, Math.min(rest.length, move.philosophySpent));
  const ordered = [
    { track: first, spendsPhilosophy: false },
    ...rest.slice(0, extraCount).map(track => ({ track, spendsPhilosophy: true })),
    ...rest.slice(extraCount).map(track => ({ track, spendsPhilosophy: false })),
  ];

  for (const step of ordered) {
    if (step.spendsPhilosophy) {
      if (philosophyTokens <= 0) return false;
      philosophyTokens -= 1;
    }
    if (progressLevel(shadow, step.track) >= 7) return false;
    const cost = discountedProgressCost(shadow, privateState, step.track, 0);
    if (cost > shadow.coins) return false;
    shadow = advanceVirtualProgress(shadow, step.track, cost);
  }
  return true;
}

function advanceVirtualProgress(player: PublicPlayerState, track: ProgressTrackType, cost: number): PublicPlayerState {
  const next = progressLevel(player, track) + 1;
  if (track === 'ECONOMY') return { ...player, coins: player.coins - cost, economyTrack: next };
  if (track === 'CULTURE') return { ...player, coins: player.coins - cost, cultureTrack: next };
  return { ...player, coins: player.coins - cost, militaryTrack: next };
}

function buildCheatCommand(
  move: RecommendedMove,
  gameState: PublicGameState,
  privateState: PrivatePlayerState,
  currentPlayerId: string,
  plan?: Plan | null,
): CheatCommand | null {
  const pending = currentPendingDecision(gameState, currentPlayerId);
  if (!pending) return null;

  let message: ClientMessage | null = null;
  let label = '';

  if (move.kind === 'ASSIGN_DICE') {
    if (pending.decisionType !== 'ASSIGN_DICE') return null;
    const assignedDice = move.assignments.map(assignment => assignment.dieValue).sort((a, b) => a - b);
    const liveDice = [...(privateState.diceRoll ?? [])].sort((a, b) => a - b);
    if (assignedDice.length !== liveDice.length || assignedDice.some((die, index) => die !== liveDice[index])) return null;
    if (plan && !currentRoundPlanIsExecutable(plan, gameState, privateState, currentPlayerId)) return null;
    message = {
      type: 'ASSIGN_DICE',
      assignments: move.assignments.map((assignment, index) => ({
        slotIndex: index as 0 | 1 | 2,
        actionType: assignment.action as ActionType,
        dieValue: assignment.dieValue,
      })),
      philosophyTokensToSpend: move.philosophyTokensToSpend,
    };
    label = `assigned dice ${move.assignments.map(a => `${formatCheatAction(a.action)} ${a.dieValue}`).join(', ')}`;
  } else if (move.kind === 'RESOLVE_ACTION') {
    if (pending.decisionType !== 'RESOLVE_ACTION') return null;
    if (nextResolvableAction(privateState.actionSlots) !== move.actionType) return null;
    if (!solverActionChoicesAreLive(move.actionType as ActionType, move.choices, gameState, privateState, currentPlayerId)) return null;
    message = { type: 'RESOLVE_ACTION', actionType: move.actionType as ActionType, choices: move.choices };
    label = `resolved ${formatCheatAction(move.actionType)}`;
  } else if (move.kind === 'PROGRESS_TRACK') {
    if (pending.decisionType !== 'PROGRESS_TRACK') return null;
    const me = gameState.players.find(player => player.playerId === currentPlayerId);
    if (!me || !solverProgressMoveIsLive(move, me, privateState)) return null;
    const [first, ...rest] = move.tracks;
    const extraCount = Math.max(0, Math.min(rest.length, move.philosophySpent));
    const extraTracks = rest.slice(0, extraCount).map(track => ({ track }));
    const bonusTracks = rest.slice(extraCount).map(track => ({ track }));
    message = first
      ? {
          type: 'PROGRESS_TRACK',
          advancement: { track: first },
          extraTracks,
          bonusTracks,
        }
      : { type: 'SKIP_PHASE' };
    label = first ? `advanced ${move.tracks.join(', ')}` : 'skipped progress';
  } else if (move.kind === 'ACHIEVEMENT_TRACK_CHOICE') {
    if (pending.decisionType !== 'ACHIEVEMENT_TRACK_CHOICE') return null;
    const trackChoice = move.choices[0] ?? 'TAX';
    message = { type: 'CLAIM_ACHIEVEMENT', achievementId: '', trackChoice };
    label = `chose +1 ${trackChoice === 'TAX' ? 'Tax' : 'Glory'}`;
  }

  return message
    ? makeCheatCommand(pending, message, label)
    : null;
}

function buildDirectCheatCommand(
  result: SolverResult | null,
  gameState: PublicGameState,
  privateState: PrivatePlayerState,
  currentPlayerId: string,
): CheatCommand | null {
  const pending = currentPendingDecision(gameState, currentPlayerId);
  if (!pending) return null;
  const me = gameState.players.find(p => p.playerId === currentPlayerId) ?? null;
  const draft = result && result.ok && 'draft' in result ? result.draft : null;

  switch (pending.decisionType) {
    case 'SELECT_CITY': {
      const city = chooseBestCity(privateState.offeredCities ?? []);
      return city
        ? makeCheatCommand(pending, { type: 'SELECT_CITY', cityId: city.id }, `selected ${city.name}`)
        : null;
    }
    case 'DRAFT_CARD': {
      const pick = draft?.isMyTurn ? draft.recommendations[0] : null;
      return pick
        ? makeCheatCommand(pending, { type: 'DRAFT_CARD', cardId: pick.cardId }, `drafted ${pick.cardName}`)
        : null;
    }
    case 'PICK_BAN_CARD': {
      const pick = draft?.isMyTurn ? draft.recommendations[0] : null;
      const action = draft?.action ?? gameState.pickBanDraft?.phase;
      return pick && action
        ? makeCheatCommand(pending, { type: 'PICK_BAN_CARD', cardId: pick.cardId, action }, `${action === 'BAN' ? 'banned' : 'picked'} ${pick.cardName}`)
        : null;
    }
    case 'ROLL_DICE':
      return makeCheatCommand(pending, { type: 'ROLL_DICE' }, 'rolled dice');
    case 'ASSIGN_DICE': {
      if (!me) return null;
      const command = buildDirectDiceAssignmentMessage(gameState, privateState, me);
      return command
        ? directCommandToCheatCommand(pending, command)
        : null;
    }
    case 'RESOLVE_ACTION': {
      if (!me) return null;
      const action = nextResolvableAction(privateState.actionSlots);
      const command = action
        ? buildDirectActionMessage(action, gameState, privateState, me)
        : null;
      return command
        ? directCommandToCheatCommand(pending, command)
        : action && actionCanBeSkipped(action)
          ? makeCheatCommand(pending, { type: 'SKIP_PHASE' }, `skipped ${formatCheatAction(action)}`)
          : null;
    }
    case 'PROGRESS_TRACK': {
      if (!me) return null;
      const track = bestProgressTrack(me, privateState, ['ECONOMY', 'CULTURE', 'MILITARY'], 0);
      return makeCheatCommand(
        pending,
        track ? { type: 'PROGRESS_TRACK', advancement: { track } } : { type: 'SKIP_PHASE' },
        track ? `advanced ${track}` : 'skipped progress',
      );
    }
    case 'ACHIEVEMENT_TRACK_CHOICE': {
      const trackChoice = preferGloryForAchievement(me, privateState) ? 'GLORY' : 'TAX';
      return makeCheatCommand(
        pending,
        { type: 'CLAIM_ACHIEVEMENT', achievementId: '', trackChoice },
        `chose +1 ${trackChoice === 'TAX' ? 'Tax' : 'Glory'}`,
      );
    }
    case 'ORACLE_CHOOSE_TOKEN': {
      const token = chooseOracleTokenToLose(privateState.knowledgeTokens);
      return token
        ? makeCheatCommand(pending, { type: 'CHOOSE_TOKEN', tokenId: token.id }, `lost ${token.color} ${token.tokenType.toLowerCase()} token`)
        : makeCheatCommand(pending, { type: 'SKIP_PHASE' }, 'skipped Oracle choice');
    }
    case 'MILITARY_VICTORY_PROGRESS': {
      if (!me) return null;
      const track = bestProgressTrack(me, privateState, ['ECONOMY', 'CULTURE', 'MILITARY'], 2);
      return makeCheatCommand(
        pending,
        track ? { type: 'EVENT_PROGRESS_TRACK', track } : { type: 'SKIP_PHASE' },
        track ? `advanced ${track} from Military Victory` : 'skipped Military Victory progress',
      );
    }
    case 'RISE_OF_PERSIA_PROGRESS': {
      if (!me) return null;
      const track = bestProgressTrack(me, privateState, ['MILITARY'], 2);
      return makeCheatCommand(
        pending,
        track ? { type: 'EVENT_PROGRESS_TRACK', track } : { type: 'SKIP_PHASE' },
        track ? 'advanced Military from Rise of Persia' : 'skipped Rise of Persia progress',
      );
    }
    case 'THIRTY_TYRANTS_DISCARD': {
      const toDiscard = chooseCardsToDiscard(privateState.handCards, privateState);
      return toDiscard.length > 0
        ? makeCheatCommand(pending, { type: 'DISCARD_CARDS', cardIds: toDiscard.map(card => card.id) }, `discarded ${toDiscard.map(card => card.name).join(', ')}`)
        : makeCheatCommand(pending, { type: 'SKIP_PHASE' }, 'skipped discard');
    }
    case 'PROSPERITY_POLITICS': {
      if (!me) return makeCheatCommand(pending, { type: 'SKIP_PHASE' }, 'skipped Prosperity politics');
      const command = buildDirectActionMessage('POLITICS', gameState, privateState, me, 'Prosperity');
      return command
        ? directCommandToCheatCommand(pending, command)
        : makeCheatCommand(pending, { type: 'SKIP_PHASE' }, 'skipped Prosperity politics');
    }
    case 'CONQUEST_ACTION': {
      const command = buildConquestActionMessage(gameState, privateState, currentPlayerId);
      return command
        ? directCommandToCheatCommand(pending, command)
        : makeCheatCommand(pending, { type: 'SKIP_PHASE' }, 'skipped Conquest action');
    }
    default:
      return null;
  }
}

function chooseBestCity(cities: NonNullable<PrivatePlayerState['offeredCities']>) {
  return [...cities].sort((a, b) => cityDraftScore(b) - cityDraftScore(a) || a.name.localeCompare(b.name))[0] ?? null;
}

function cityDraftScore(city: NonNullable<PrivatePlayerState['offeredCities']>[number]): number {
  const tracks = city.startingTracks;
  const devScore = city.developments.reduce((sum, dev) => {
    const typeValue = dev.effectType === 'END_GAME' ? 9 : dev.effectType === 'ONGOING' ? 7 : 4;
    return sum + typeValue + Math.max(0, 4 - dev.drachmaCost);
  }, 0);
  return city.startingCoins * 1.5
    + tracks.economy * 7
    + tracks.culture * 8
    + tracks.military * 6
    + tracks.tax * 4
    + tracks.glory * 5
    + tracks.troop * 1.5
    + tracks.citizen * 2
    + devScore;
}

function chooseOracleTokenToLose(tokens: KnowledgeToken[]): KnowledgeToken | null {
  const colorCounts = countTokenColors(tokens);
  return [...tokens].sort((a, b) => oracleLossValue(a, colorCounts) - oracleLossValue(b, colorCounts))[0] ?? null;
}

function oracleLossValue(token: KnowledgeToken, colorCounts: Record<KnowledgeColor, number>): number {
  const colorWeight: Record<KnowledgeColor, number> = { GREEN: 1, BLUE: 2, RED: 3 };
  const duplicateDiscount = colorCounts[token.color] > 1 ? -4 : 0;
  return (token.tokenType === 'MAJOR' ? 100 : 10) + colorWeight[token.color] + duplicateDiscount;
}

function chooseCardsToDiscard(cards: PoliticsCard[], privateState: PrivatePlayerState): PoliticsCard[] {
  return [...cards]
    .sort((a, b) => autopilotCardScore(a, privateState) - autopilotCardScore(b, privateState) || b.cost - a.cost)
    .slice(0, Math.min(2, cards.length));
}

function chooseBestPlayablePoliticsCard(privateState: PrivatePlayerState): { card: PoliticsCard; choices: ActionChoices; score: number } | null {
  const candidates = privateState.handCards
    .map(card => {
      const choices = politicsChoicesForCard(card, privateState);
      return choices ? { card, choices, score: autopilotCardScore(card, privateState) - card.cost } : null;
    })
    .filter((entry): entry is { card: PoliticsCard; choices: ActionChoices; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name));
  return candidates[0] ?? null;
}

function politicsChoicesForCard(card: PoliticsCard, privateState: PrivatePlayerState): ActionChoices | null {
  if (privateState.coins < card.cost) return null;
  const shortfall = knowledgeShortfall(card, privateState.knowledgeTokens);
  const philosophyPairsToUse = shortfall > 0 ? shortfall : undefined;
  if (shortfall > Math.floor(privateState.philosophyTokens / 2)) return null;
  const choices: ActionChoices = { targetCardId: card.id };
  if (philosophyPairsToUse) choices.philosophyPairsToUse = philosophyPairsToUse;
  if (card.id === 'scholarly-welcome') choices.scholarlyWelcomeColor = bestMinorColor(privateState.knowledgeTokens);
  if (card.id === 'ostracism') {
    const returnCard = chooseBestOstracismReturnCard(privateState);
    if (!returnCard) return null;
    choices.ostracismReturnCardId = returnCard.id;
  }
  return choices;
}

function chooseBestOstracismReturnCard(privateState: PrivatePlayerState): PoliticsCard | null {
  return privateState.playedCards
    .filter(card => card.id !== 'ostracism')
    .sort((a, b) => autopilotCardScore(b, privateState) - autopilotCardScore(a, privateState) || a.name.localeCompare(b.name))[0] ?? null;
}

function knowledgeShortfall(card: PoliticsCard, tokens: KnowledgeToken[]): number {
  const counts = countTokenColors(tokens);
  return Math.max(0, card.knowledgeRequirement.green - counts.GREEN)
    + Math.max(0, card.knowledgeRequirement.blue - counts.BLUE)
    + Math.max(0, card.knowledgeRequirement.red - counts.RED);
}

function countTokenColors(tokens: KnowledgeToken[]): Record<KnowledgeColor, number> {
  return tokens.reduce<Record<KnowledgeColor, number>>((counts, token) => {
    counts[token.color] += 1;
    return counts;
  }, { GREEN: 0, BLUE: 0, RED: 0 });
}

function bestMinorColor(tokens: KnowledgeToken[]): KnowledgeColor {
  const counts = countTokenColors(tokens);
  return (['RED', 'BLUE', 'GREEN'] as KnowledgeColor[])
    .sort((a, b) => counts[a] - counts[b])[0] ?? 'BLUE';
}

function autopilotCardScore(card: PoliticsCard, privateState: PrivatePlayerState): number {
  const base = AUTOPILOT_CARD_VALUE[card.id]
    ?? (card.type === 'END_GAME' ? 58 : card.type === 'ONGOING' ? 52 : 42);
  const knowledgeDemand = card.knowledgeRequirement.green + card.knowledgeRequirement.blue + card.knowledgeRequirement.red;
  const affordabilityPenalty = Math.max(0, card.cost - privateState.coins) * 4;
  return base + knowledgeDemand * 4 + card.cost * 0.8 - affordabilityPenalty;
}

function buildConquestActionMessage(
  gameState: PublicGameState,
  privateState: PrivatePlayerState,
  currentPlayerId: string,
): DirectActionCommand | null {
  const me = gameState.players.find(p => p.playerId === currentPlayerId);
  if (!me) return null;
  const actions: ActionType[] = ['POLITICS', 'DEVELOPMENT', 'LEGISLATION', 'TRADE', 'CULTURE', 'PHILOSOPHY'];
  return actions
    .map(action => buildDirectActionMessage(action, gameState, privateState, me, 'Conquest'))
    .filter((command): command is DirectActionCommand => command !== null)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))[0] ?? null;
}

function buildDirectDiceAssignmentMessage(
  gameState: PublicGameState,
  privateState: PrivatePlayerState,
  player: PublicPlayerState,
): DirectActionCommand | null {
  const dice = privateState.diceRoll;
  if (!dice || dice.length === 0) return null;
  const actionCandidates = (Object.keys(ACTION_NUMBERS) as ActionType[])
    .map(action => {
      const command = buildDirectActionMessage(action, gameState, privateState, player);
      return command
        ? { action, score: command.score + diceAssignmentBias(action, player, privateState) }
        : null;
    })
    .filter((candidate): candidate is { action: ActionType; score: number } => candidate !== null);
  if (actionCandidates.length < dice.length) return null;

  let best: { assignments: DiceAssignment[]; philosophyTokensToSpend: number; score: number } | null = null;
  for (const combo of combinations(actionCandidates, dice.length)) {
    const mapped = bestDiceMapping(combo.map(candidate => candidate.action), dice);
    if (!mapped) continue;
    const deficit = Math.max(0, mapped.citizenCost - player.citizenTrack);
    const philosophyTokensToSpend = Math.ceil(deficit / 3);
    if (philosophyTokensToSpend > privateState.philosophyTokens) continue;
    const score = combo.reduce((sum, candidate) => sum + candidate.score, 0)
      - mapped.citizenCost * 2.6
      - philosophyTokensToSpend * 1.4;
    if (!best || score > best.score) {
      best = { assignments: mapped.assignments, philosophyTokensToSpend, score };
    }
  }
  if (!best) return null;
  return {
    message: {
      type: 'ASSIGN_DICE',
      assignments: best.assignments,
      philosophyTokensToSpend: best.philosophyTokensToSpend > 0 ? best.philosophyTokensToSpend : undefined,
    },
    label: `assigned dice to ${best.assignments.map(assignment => formatCheatAction(assignment.actionType)).join(', ')}`,
    score: best.score,
  };
}

function bestDiceMapping(actions: ActionType[], dice: number[]): { assignments: DiceAssignment[]; citizenCost: number } | null {
  let best: { assignments: DiceAssignment[]; citizenCost: number } | null = null;
  for (const permutation of permutations(dice)) {
    const assignments = actions.map((action, index) => ({
      slotIndex: index as 0 | 1 | 2,
      actionType: action,
      dieValue: permutation[index],
    }));
    const citizenCost = assignments.reduce(
      (sum, assignment) => sum + Math.max(0, ACTION_NUMBERS[assignment.actionType] - assignment.dieValue),
      0,
    );
    if (!best || citizenCost < best.citizenCost) {
      best = { assignments, citizenCost };
    }
  }
  return best;
}

function diceAssignmentBias(action: ActionType, player: PublicPlayerState, privateState: PrivatePlayerState): number {
  if (action === 'LEGISLATION') return privateState.handCards.length <= 1 ? 6 : 2;
  if (action === 'POLITICS') return privateState.handCards.length * 0.8;
  if (action === 'DEVELOPMENT') return Math.max(0, 4 - player.developmentLevel) * 2;
  if (action === 'TRADE') return privateState.coins <= 3 ? 4 : 1;
  if (action === 'MILITARY') return player.militaryTrack * 0.5;
  if (action === 'CULTURE') return player.cultureTrack >= 4 ? 1 : 4;
  return 1;
}

function combinations<T>(items: T[], count: number): T[][] {
  if (count === 0) return [[]];
  if (items.length < count) return [];
  const [first, ...rest] = items;
  return [
    ...combinations(rest, count - 1).map(combo => [first, ...combo]),
    ...combinations(rest, count),
  ];
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    return permutations(rest).map(permutation => [item, ...permutation]);
  });
}

function buildDirectActionMessage(
  actionType: ActionType,
  gameState: PublicGameState,
  privateState: PrivatePlayerState,
  player: PublicPlayerState,
  source?: string,
): DirectActionCommand | null {
  const suffix = source ? ` from ${source}` : '';
  switch (actionType) {
    case 'PHILOSOPHY':
      return {
        message: { type: 'RESOLVE_ACTION', actionType: 'PHILOSOPHY', choices: {} },
        label: `resolved Philosophy${suffix}`,
        score: 7 + privateState.philosophyTokens * 0.2 + (hasPlayedCard(privateState, 'founding-the-lyceum') ? 3 : 0),
      };
    case 'LEGISLATION': {
      const plan = legislationActionPlan(privateState);
      return {
        message: { type: 'RESOLVE_ACTION', actionType: 'LEGISLATION', choices: plan.choices },
        label: plan.card ? `kept ${plan.card.name}${suffix}` : `resolved Legislation${suffix}`,
        score: plan.score,
      };
    }
    case 'CULTURE':
      return {
        message: { type: 'RESOLVE_ACTION', actionType: 'CULTURE', choices: {} },
        label: `resolved Culture${suffix}`,
        score: cultureActionScore(player, privateState),
      };
    case 'TRADE': {
      const plan = tradeActionPlan(player, privateState);
      return {
        message: { type: 'RESOLVE_ACTION', actionType: 'TRADE', choices: plan.choices },
        label: plan.choices.buyMinorKnowledge
          ? `traded and bought a ${plan.choices.minorKnowledgeColor?.toLowerCase()} token${suffix}`
          : `resolved Trade${suffix}`,
        score: plan.score,
      };
    }
    case 'MILITARY': {
      const plan = militaryActionPlan(gameState, player, privateState);
      return {
        message: { type: 'RESOLVE_ACTION', actionType: 'MILITARY', choices: plan.choices },
        label: plan.tokenNames.length > 0
          ? `explored ${plan.tokenNames.join(', ')}${suffix}`
          : `resolved Military${suffix}`,
        score: plan.score,
      };
    }
    case 'POLITICS': {
      const politics = chooseBestPlayablePoliticsCard(privateState);
      if (!politics) return null;
      const score = 34 + politics.score + politicsActionBonus(player, privateState);
      return {
        message: { type: 'RESOLVE_ACTION', actionType: 'POLITICS', choices: politics.choices },
        label: `played ${politics.card.name}${suffix}`,
        score,
      };
    }
    case 'DEVELOPMENT': {
      const plan = developmentActionPlan(gameState, player, privateState);
      return plan
        ? {
            message: { type: 'RESOLVE_ACTION', actionType: 'DEVELOPMENT', choices: plan.choices },
            label: `developed ${plan.development.name}${suffix}`,
            score: plan.score,
          }
        : null;
    }
    default:
      return null;
  }
}

function legislationActionPlan(privateState: PrivatePlayerState): { choices: ActionChoices; card: PoliticsCard | null; score: number } {
  const draw = privateState.legislationDraw?.length
    ? privateState.legislationDraw
    : (privateState.solverFullState?.politicsDeck.slice(0, 2) ?? []);
  const keep = [...draw]
    .sort((a, b) => autopilotCardScore(b, privateState) - autopilotCardScore(a, privateState) || a.name.localeCompare(b.name))[0] ?? null;
  const discard = keep ? draw.find(card => card.id !== keep.id) ?? null : null;
  return {
    choices: keep ? { targetCardId: keep.id, discardCardId: discard?.id } : {},
    card: keep,
    score: keep ? 12 + autopilotCardScore(keep, privateState) * 0.2 : 5,
  };
}

function tradeActionPlan(player: PublicPlayerState, privateState: PrivatePlayerState): { choices: ActionChoices; score: number } {
  const income = player.economyTrack + 1;
  const tokenCost = minorKnowledgeCost(privateState);
  const canBuyMinor = privateState.coins + income >= tokenCost;
  return {
    choices: canBuyMinor
      ? { buyMinorKnowledge: true, minorKnowledgeColor: bestMinorColor(privateState.knowledgeTokens) }
      : {},
    score: 9 + income * 1.2 + (canBuyMinor ? 13 : 0)
      + (hasPlayedCard(privateState, 'diolkos') ? 4 : 0)
      + (hasPlayedCard(privateState, 'lighthouse') ? 5 : 0)
      + (hasCityDevelopment(player, 'miletus', 3) ? 4 : 0),
  };
}

function minorKnowledgeCost(privateState: PrivatePlayerState): number {
  return hasPlayedCard(privateState, 'corinthian-columns') ? 3 : 5;
}

function militaryActionPlan(
  gameState: PublicGameState,
  player: PublicPlayerState,
  privateState: PrivatePlayerState,
): { choices: ActionChoices; tokenNames: string[]; score: number } {
  const maxExplores = hasCityDevelopment(player, 'thebes', 3) ? 2 : 1;
  const tokenIds = chooseExploreTokenIds(
    gameState,
    privateState,
    player,
    maxExplores,
    player.troopTrack + player.militaryTrack,
  );
  const choices: ActionChoices = {};
  if (tokenIds[0]) choices.explorationTokenId = tokenIds[0];
  if (tokenIds[1]) choices.secondExplorationTokenId = tokenIds[1];
  return {
    choices,
    tokenNames: tokenIds.map(id => tokenLabel(gameState.centralBoardTokens.find(token => token.id === id))).filter(Boolean),
    score: 10 + player.militaryTrack * 1.5
      + tokenIds.reduce((sum, id) => sum + tokenScoreById(gameState, id, privateState, player), 0)
      + (hasCityDevelopment(player, 'sparta', 2) ? 3 : 0),
  };
}

function developmentActionPlan(
  gameState: PublicGameState,
  player: PublicPlayerState,
  privateState: PrivatePlayerState,
): { choices: ActionChoices; development: NonNullable<ReturnType<typeof nextDevelopmentForPlayer>>; score: number } | null {
  const development = nextDevelopmentForPlayer(gameState, player);
  if (!development) return null;
  const shortfall = requirementShortfall(development.knowledgeRequirement, privateState.knowledgeTokens);
  if (privateState.coins < development.drachmaCost || shortfall * 2 > privateState.philosophyTokens) return null;

  const choices: ActionChoices = {};
  if (shortfall > 0) choices.philosophyPairsToUse = shortfall;

  let specialScore = 0;
  if (development.id === 'miletus-dev-2') {
    choices.devTrackChoices = bestFreeProgressTracks(player, 2);
    specialScore += choices.devTrackChoices.reduce((sum, track) => sum + progressAdvanceValue(player, track), 0);
  }
  if (development.id === 'argos-dev-2') {
    choices.argosDevReward = bestArgosReward(player, privateState);
    specialScore += choices.argosDevReward === 'vp' ? 8 : choices.argosDevReward === 'citizens' ? 6 : 5;
  }
  if (development.id === 'sparta-dev-3') {
    const tokenIds = chooseExploreTokenIds(
      gameState,
      privateState,
      player,
      2,
      player.troopTrack + player.militaryTrack,
      player.militaryTrack,
    );
    if (tokenIds.length > 0) choices.spartaMilitaryTokenIds = tokenIds;
    specialScore += tokenIds.reduce((sum, id) => sum + tokenScoreById(gameState, id, privateState, player), 0);
  }

  return {
    choices,
    development,
    score: 22 + development.level * 4 + developmentEffectValue(development) + specialScore
      - development.drachmaCost * 0.9 - shortfall * 2,
  };
}

function nextDevelopmentForPlayer(gameState: PublicGameState, player: PublicPlayerState) {
  return gameState.cityCards[player.cityId]?.developments[player.developmentLevel] ?? null;
}

function requirementShortfall(
  requirement: { green: number; blue: number; red: number },
  tokens: KnowledgeToken[],
): number {
  const counts = countTokenColors(tokens);
  return Math.max(0, requirement.green - counts.GREEN)
    + Math.max(0, requirement.blue - counts.BLUE)
    + Math.max(0, requirement.red - counts.RED);
}

function bestFreeProgressTracks(player: PublicPlayerState, count: number): ProgressTrackType[] {
  return (['ECONOMY', 'CULTURE', 'MILITARY'] as ProgressTrackType[])
    .filter(track => progressLevel(player, track) < 7)
    .sort((a, b) => progressAdvanceValue(player, b) - progressAdvanceValue(player, a))
    .slice(0, count);
}

function bestArgosReward(player: PublicPlayerState, privateState: PrivatePlayerState): NonNullable<ActionChoices['argosDevReward']> {
  if (player.citizenTrack <= 3) return 'citizens';
  if (privateState.coins <= 2) return 'coins';
  if (player.militaryTrack >= 5 && player.troopTrack < 6) return 'troops';
  return 'vp';
}

function developmentEffectValue(development: NonNullable<ReturnType<typeof nextDevelopmentForPlayer>>): number {
  if (development.effectType === 'END_GAME') return 16;
  if (development.effectType === 'ONGOING') return 12;
  return 9;
}

function chooseExploreTokenIds(
  gameState: PublicGameState,
  privateState: PrivatePlayerState,
  player: PublicPlayerState,
  maxCount: number,
  startingTroops: number,
  gainBetweenExplores = 0,
): string[] {
  let troops = startingTroops;
  const chosen: string[] = [];
  for (let i = 0; i < maxCount; i += 1) {
    const token = gameState.centralBoardTokens
      .filter(candidate =>
        !candidate.explored
        && !chosen.includes(candidate.id)
        && candidate.militaryRequirement !== undefined
        && candidate.militaryRequirement <= troops,
      )
      .sort((a, b) => exploreTokenScore(b, privateState, player) - exploreTokenScore(a, privateState, player)
        || (a.skullValue ?? 0) - (b.skullValue ?? 0))[0] ?? null;
    if (!token) break;
    chosen.push(token.id);
    troops = Math.max(0, troops - exploreTroopLoss(token, privateState, player));
    if (i < maxCount - 1) troops += gainBetweenExplores;
  }
  return chosen;
}

function tokenScoreById(
  gameState: PublicGameState,
  tokenId: string,
  privateState: PrivatePlayerState,
  player: PublicPlayerState,
): number {
  const token = gameState.centralBoardTokens.find(candidate => candidate.id === tokenId);
  return token ? exploreTokenScore(token, privateState, player) : 0;
}

function exploreTokenScore(token: KnowledgeToken, privateState: PrivatePlayerState, player: PublicPlayerState): number {
  const counts = countTokenColors(privateState.knowledgeTokens);
  const colorNeed = counts[token.color] === 0 ? 6 : token.tokenType === 'MAJOR' ? 3 : 0;
  const typeValue = token.isPersepolis ? 42 : token.tokenType === 'MAJOR' ? 18 : 8;
  const skullPenalty = exploreTroopLoss(token, privateState, player) * 0.7;
  return typeValue + colorNeed + (token.bonusVP ?? 0) * 1.4 + (token.bonusCoins ?? 0) * 0.9 - skullPenalty;
}

function exploreTroopLoss(token: KnowledgeToken, privateState: PrivatePlayerState, player: PublicPlayerState): number {
  const discount = (hasPlayedCard(privateState, 'helepole') ? 1 : 0) + (hasCityDevelopment(player, 'sparta', 1) ? 1 : 0);
  return Math.max(0, (token.skullValue ?? 0) - discount);
}

function tokenLabel(token: KnowledgeToken | undefined): string {
  if (!token) return '';
  if (token.isPersepolis) return 'Persepolis';
  return `${token.color.toLowerCase()} ${token.tokenType.toLowerCase()}`;
}

function cultureActionScore(player: PublicPlayerState, privateState: PrivatePlayerState): number {
  return 8 + player.cultureTrack * 2
    + (hasPlayedCard(privateState, 'stoa-poikile') ? 3 : 0)
    + (hasPlayedCard(privateState, 'persians') ? 3 : 0)
    + (hasCityDevelopment(player, 'olympia', 2) ? 3 : 0);
}

function politicsActionBonus(player: PublicPlayerState, privateState: PrivatePlayerState): number {
  return (hasPlayedCard(privateState, 'extraordinary-collection') ? 4 : 0)
    + (hasCityDevelopment(player, 'athens', 2) ? 5 : 0)
    + (hasCityDevelopment(player, 'athens', 3) ? 2 : 0);
}

function hasCityDevelopment(player: PublicPlayerState, cityId: string, level: number): boolean {
  return player.cityId === cityId && player.developmentLevel >= level;
}

function bestProgressTrack(
  player: PublicPlayerState,
  privateState: PrivatePlayerState,
  tracks: ProgressTrackType[],
  discount: number,
): ProgressTrackType | null {
  const candidates = tracks
    .map(track => {
      const level = progressLevel(player, track);
      if (level >= 7) return null;
      const cost = discountedProgressCost(player, privateState, track, discount);
      if (cost > player.coins) return null;
      return { track, score: progressAdvanceValue(player, track) - cost * 1.1 };
    })
    .filter((entry): entry is { track: ProgressTrackType; score: number } => entry !== null)
    .sort((a, b) => b.score - a.score);
  return candidates[0]?.track ?? null;
}

function progressLevel(player: PublicPlayerState, track: ProgressTrackType): number {
  if (track === 'ECONOMY') return player.economyTrack;
  if (track === 'CULTURE') return player.cultureTrack;
  return player.militaryTrack;
}

function discountedProgressCost(
  player: PublicPlayerState,
  privateState: PrivatePlayerState,
  track: ProgressTrackType,
  eventDiscount: number,
): number {
  let cost = PROGRESS_COSTS[track][progressLevel(player, track)] ?? 99;
  if (track === 'ECONOMY' && hasPlayedCard(privateState, 'constructing-the-mint')) cost = 0;
  if (cost > 0 && hasPlayedCard(privateState, 'gradualism')) cost = Math.max(0, cost - 1);
  if (cost > 0 && player.cityId === 'corinth' && player.developmentLevel >= 3) cost = Math.max(0, cost - 1);
  return Math.max(0, cost - eventDiscount);
}

function progressAdvanceValue(player: PublicPlayerState, track: ProgressTrackType): number {
  const next = progressLevel(player, track) + 1;
  if (track === 'ECONOMY') {
    const citizenBonus = next === 2 || next === 3 ? 3 : next === 5 ? 5 : 0;
    const vpBonus = next === 4 ? 5 : next === 7 ? 10 : 0;
    return 3 + next * 0.8 + citizenBonus * 0.7 + vpBonus;
  }
  if (track === 'CULTURE') {
    const taxBonus = next === 3 || next === 5 || next === 6 ? 4 : next === 7 ? 8 : 0;
    const thirdDieBonus = next === 4 ? 12 : 0;
    return 3 + next + taxBonus + thirdDieBonus;
  }
  const gloryBonus = next === 2 || next === 4 || next === 6 ? 4 : next === 7 ? 8 : 0;
  return 3 + next * 1.2 + gloryBonus + player.troopTrack * 0.2;
}

function hasPlayedCard(privateState: PrivatePlayerState, cardId: string): boolean {
  return privateState.playedCards.some(card => card.id === cardId);
}

function preferGloryForAchievement(player: PublicPlayerState | null, privateState: PrivatePlayerState): boolean {
  if (!player || player.gloryTrack >= 10) return false;
  const majorCount = privateState.knowledgeTokens.filter(token => token.tokenType === 'MAJOR').length;
  return majorCount > 0 || player.taxTrack >= 8;
}

function autopilotBlockedReason(
  pending: NonNullable<ReturnType<typeof currentPendingDecision>> | null,
  solverResult: SolverResult | null,
  move: RecommendedMove | null,
  solverCommand: CheatCommand | null,
): string | null {
  if (!pending) return null;
  if ((pending.decisionType === 'ASSIGN_DICE'
    || pending.decisionType === 'RESOLVE_ACTION'
    || pending.decisionType === 'PROGRESS_TRACK')
    && !move) {
    return solverResult === null ? 'waiting for the first solver line' : `waiting for a ${pending.decisionType.toLowerCase().replaceAll('_', ' ')} recommendation`;
  }
  if (move && !solverCommand && (pending.decisionType === 'ASSIGN_DICE' || pending.decisionType === 'RESOLVE_ACTION')) {
    return 'recommended move no longer matches the live board';
  }
  return `no safe autopilot command for ${pending.decisionType.toLowerCase().replaceAll('_', ' ')}`;
}

function pendingDecisionNeedsSolver(pending: NonNullable<ReturnType<typeof currentPendingDecision>>): boolean {
  return pending.decisionType === 'ASSIGN_DICE'
    || pending.decisionType === 'RESOLVE_ACTION'
    || pending.decisionType === 'PROGRESS_TRACK'
    || pending.decisionType === 'ACHIEVEMENT_TRACK_CHOICE';
}

function solverPlanAutopilotSignature(plan: Plan | null): string | null {
  if (!plan) return null;
  const firstMove = plan.currentRound?.recommendedMoves[0];
  return JSON.stringify({
    objectiveScore: Math.round(plan.objectiveScore * 10) / 10,
    final: plan.projectedFinalVP,
    round: plan.currentRound?.round ?? null,
    firstMove,
  });
}

function solverPlanReadyForAutopilot(plan: Plan | null, visibleMs: number): boolean {
  return Boolean(plan
    && !plan.partialResult
    && (plan.objective !== 'WIN_MARGIN' || plan.analysisMode === 'ADVERSARIAL')
    && Math.max(plan.computeMs, visibleMs) >= AUTOPILOT_MIN_SOLVER_MS);
}

function formatCheatAction(action: string): string {
  return action.charAt(0) + action.slice(1).toLowerCase();
}

export const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('NAME');
  const [playerName, setPlayerName] = useState('');
  const [currentPlayerId, setCurrentPlayerId] = useState('');
  const [hostPlayerId, setHostPlayerId] = useState('');
  const [lobbyId, setLobbyId] = useState('');
  const [lobbyPlayers, setLobbyPlayers] = useState<PlayerInfo[]>([]);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [recordStats, setRecordStats] = useState(true);
  const [draftMode, setDraftMode] = useState<DraftMode>('STANDARD');

  const { gameState, privateState, finalScores, connected, error: wsError, sendMessage, adminDeckCards, adminEventCards, adminUnusedEvents } =
    useGameSocket(gameId, currentPlayerId);

  const { adminPanel, deactivateAdmin } = useAdminMode();

  // ─── Solver mode ('''''9 secret toggle) ───
  const solverMode = useSolverMode(gameState, privateState, currentPlayerId);
  useSolverKeybind(solverMode.toggle);
  const [cheatControlMode, setCheatControlModeState] = useState<CheatControlMode>('COACH');
  const [cheatLog, setCheatLog] = useState<string[]>([]);
  const [autopilotPauseReason, setAutopilotPauseReason] = useState<string | null>(null);
  const autoRoundAnchorRef = useRef<number | null>(null);
  const lastAutopilotSendKeyRef = useRef<string | null>(null);
  const autopilotPlanSignatureRef = useRef<string | null>(null);
  const autopilotPlanSeenAtRef = useRef(0);
  const autopilotWakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autopilotWakeTick, setAutopilotWakeTick] = useState(0);

  const appendCheatLog = useCallback((line: string) => {
    setCheatLog(prev => [`${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ${line}`, ...prev].slice(0, CHEAT_LOG_LIMIT));
  }, []);

  const setCheatControlMode = useCallback((mode: CheatControlMode) => {
    setCheatControlModeState(mode);
    setAutopilotPauseReason(null);
    lastAutopilotSendKeyRef.current = null;
    autoRoundAnchorRef.current = mode === 'AUTO_ROUND' ? (gameState?.roundNumber ?? null) : null;
    appendCheatLog(
      mode === 'COACH'
        ? 'Autopilot paused'
        : mode === 'AUTO_DECISION'
          ? 'Armed for the next executable decision'
          : `Autopilot armed for round ${gameState?.roundNumber ?? '?'}`,
    );
  }, [appendCheatLog, gameState?.roundNumber]);

  // When an admin panel activates, request the relevant data
  useEffect(() => {
    if (!gameId || !adminPanel) return;
    if (adminPanel === 'cards') {
      sendMessage({ type: 'ADMIN_REQUEST_DECK' });
    } else if (adminPanel === 'events') {
      sendMessage({ type: 'ADMIN_REQUEST_EVENTS' });
    }
  }, [adminPanel, gameId, sendMessage]);

  // Poll lobby for player list updates while in LOBBY screen
  useLobbyPolling(
    screen === 'LOBBY' ? lobbyId : null,
    2000,
    ({ players, started, gameId: detectedGameId, recordStats: lobbyRecordStats, draftMode: lobbyDraftMode }) => {
      setLobbyPlayers(players);
      setRecordStats(lobbyRecordStats);
      setDraftMode(lobbyDraftMode);
      if (started && detectedGameId && !gameId) {
        setGameId(detectedGameId);
        setScreen('GAME');
      }
    },
  );

  const handleCreateGame = async () => {
    try {
      const data = await createLobby(playerName);
      if (data.code) { setLobbyError(data.message); return; }
      setLobbyId(data.lobbyId);
      setHostPlayerId(data.hostPlayerId);
      setCurrentPlayerId(data.hostPlayerId);
      setLobbyPlayers([{ playerId: data.hostPlayerId, playerName }]);
      setLobbyError(null);
      setScreen('LOBBY');
    } catch { setLobbyError('Failed to create game'); }
  };

  const handleJoinLobby = async (targetLobbyId: string) => {
    try {
      const data = await joinLobby(targetLobbyId, playerName);
      if (data.code) { setLobbyError(data.message); return; }
      setLobbyId(data.lobbyId);
      setCurrentPlayerId(data.playerId);
      setLobbyPlayers(data.players);
      setHostPlayerId(data.players[0]?.playerId ?? '');
      setLobbyError(null);
      setScreen('LOBBY');
    } catch { setLobbyError('Failed to join lobby'); }
  };

  const handleStartGame = async () => {
    try {
      const data = await startGame(lobbyId, currentPlayerId);
      if (data.code) { setLobbyError(data.message); return; }
      setGameId(data.gameId);
      setScreen('GAME');
    } catch { setLobbyError('Failed to start game'); }
  };

  const handleReconnectGame = async (targetGameId: string) => {
    try {
      const data = await reconnectGame(targetGameId, playerName);
      if (data.code) { setLobbyError(data.message); return; }
      setGameId(data.gameId);
      setCurrentPlayerId(data.playerId);
      setLobbyError(null);
      setScreen('GAME');
    } catch { setLobbyError('Failed to reconnect'); }
  };

  const handleToggleRecordStats = async (value: boolean) => {
    setRecordStats(value);
    if (lobbyId) {
      await updateLobbySettings(lobbyId, { recordStats: value });
    }
  };

  const handleChangeDraftMode = async (mode: DraftMode) => {
    setDraftMode(mode);
    if (lobbyId) {
      await updateLobbySettings(lobbyId, { draftMode: mode });
    }
  };

  const handleBackToBrowse = () => {
    setLobbyId('');
    setLobbyPlayers([]);
    setLobbyError(null);
    setScreen('BROWSE');
  };

  const handleRollDice = () => sendMessage({ type: 'ROLL_DICE' });
  const handleAssignDice = (assignments: DiceAssignment[], philosophyTokensToSpend?: number) =>
    sendMessage({ type: 'ASSIGN_DICE', assignments, philosophyTokensToSpend });
  const handleUnassignDice = () => sendMessage({ type: 'UNASSIGN_DICE' });
  const handleResolveAction = (actionType: ActionType, choices: ActionChoices) =>
    sendMessage({ type: 'RESOLVE_ACTION', actionType, choices });
  const handleProgressTrack = (advancement: TrackAdvancement, extraTracks?: TrackAdvancement[], bonusTracks?: TrackAdvancement[]) =>
    sendMessage({ type: 'PROGRESS_TRACK', advancement, extraTracks, bonusTracks });
  const handleUndoProgress = () => sendMessage({ type: 'UNDO_PROGRESS' });
  const handleSkipPhase = () => sendMessage({ type: 'SKIP_PHASE' });
  const handleClaimAchievement = (achievementId: string, trackChoice: 'TAX' | 'GLORY') =>
    sendMessage({ type: 'CLAIM_ACHIEVEMENT', achievementId, trackChoice });
  const handleSelectCity = (cityId: string) => sendMessage({ type: 'SELECT_CITY', cityId });
  const handleDraftCard = (cardId: string) => sendMessage({ type: 'DRAFT_CARD', cardId });
  const handlePickBanCard = (cardId: string, action: 'BAN' | 'PICK') => sendMessage({ type: 'PICK_BAN_CARD', cardId, action });
  const handleApplySolverMove = (move: RecommendedMove) => {
    if (!gameState || !privateState) return;
    const command = buildCheatCommand(move, gameState, privateState, currentPlayerId, solverPlanFromResult(solverMode.result));
    if (!command) {
      appendCheatLog('Apply blocked: recommendation does not match the live decision');
      return;
    }
    sendMessage(command.message);
    appendCheatLog(`Applied ${command.label}`);
  };

  useEffect(() => {
    if (cheatControlMode === 'COACH') {
      autoRoundAnchorRef.current = null;
      lastAutopilotSendKeyRef.current = null;
      autopilotPlanSignatureRef.current = null;
      autopilotPlanSeenAtRef.current = 0;
      if (autopilotWakeTimeoutRef.current) {
        clearTimeout(autopilotWakeTimeoutRef.current);
        autopilotWakeTimeoutRef.current = null;
      }
      setAutopilotPauseReason(null);
      return;
    }
    if (!solverMode.enabled || !gameState || !privateState || !currentPlayerId) return;
    if (gameState.currentPhase === 'GAME_OVER') {
      setCheatControlModeState('COACH');
      setAutopilotPauseReason(null);
      appendCheatLog('Autopilot stopped: game over');
      return;
    }

    if (cheatControlMode === 'AUTO_ROUND') {
      if (autoRoundAnchorRef.current === null) autoRoundAnchorRef.current = gameState.roundNumber;
      if (gameState.roundNumber !== autoRoundAnchorRef.current) {
        setCheatControlModeState('COACH');
        setAutopilotPauseReason(null);
        appendCheatLog(`Autopilot stopped: round ${autoRoundAnchorRef.current} complete`);
        autoRoundAnchorRef.current = null;
        lastAutopilotSendKeyRef.current = null;
        return;
      }
    }

    const pending = currentPendingDecision(gameState, currentPlayerId);
    if (!pending) {
      setAutopilotPauseReason(null);
      return;
    }

    const plan = solverPlanFromResult(solverMode.result);
    const planSignature = solverPlanAutopilotSignature(plan);
    if (planSignature !== autopilotPlanSignatureRef.current) {
      autopilotPlanSignatureRef.current = planSignature;
      autopilotPlanSeenAtRef.current = planSignature ? Date.now() : 0;
    }
    if (pendingDecisionNeedsSolver(pending)) {
      if (solverMode.stale) {
        setAutopilotPauseReason('rechecking the live board');
        return;
      }
      const visibleMs = autopilotPlanSeenAtRef.current > 0 ? Date.now() - autopilotPlanSeenAtRef.current : 0;
      if (!solverPlanReadyForAutopilot(plan, visibleMs)) {
        const effectiveMs = Math.max(plan?.computeMs ?? 0, visibleMs);
        const remainingMs = Math.max(50, AUTOPILOT_MIN_SOLVER_MS - effectiveMs);
        if (!autopilotWakeTimeoutRef.current) {
          autopilotWakeTimeoutRef.current = setTimeout(() => {
            autopilotWakeTimeoutRef.current = null;
            setAutopilotWakeTick(tick => tick + 1);
          }, remainingMs);
        }
        setAutopilotPauseReason(`letting the solver deepen (${Math.round(effectiveMs)}ms)`);
        return;
      }
    }
    if (autopilotWakeTimeoutRef.current) {
      clearTimeout(autopilotWakeTimeoutRef.current);
      autopilotWakeTimeoutRef.current = null;
    }
    const phaseMoves = plan ? cheatMovesForPhase(plan, gameState.currentPhase) : [];
    let move = phaseMoves[0] ?? null;
    let solverCommand: CheatCommand | null = null;
    for (const candidate of phaseMoves) {
      const commandForCandidate = buildCheatCommand(candidate, gameState, privateState, currentPlayerId, plan);
      if (!commandForCandidate) continue;
      move = candidate;
      solverCommand = commandForCandidate;
      break;
    }
    const command = solverCommand ?? buildDirectCheatCommand(
      solverMode.result,
      gameState,
      privateState,
      currentPlayerId,
    );
    if (!command) {
      setAutopilotPauseReason(autopilotBlockedReason(pending, solverMode.result, move, solverCommand));
      return;
    }

    setAutopilotPauseReason(null);
    const sendKey = `${cheatControlMode}:${gameState.roundNumber}:${command.pendingKey}:${command.signature}`;
    if (lastAutopilotSendKeyRef.current === sendKey) return;
    lastAutopilotSendKeyRef.current = sendKey;
    sendMessage(command.message);
    appendCheatLog(`${cheatControlMode === 'AUTO_DECISION' ? 'Auto decision' : 'Auto round'}: ${command.label}`);
    if (cheatControlMode === 'AUTO_DECISION') {
      setCheatControlModeState('COACH');
    }
  }, [
    appendCheatLog,
    autopilotWakeTick,
    cheatControlMode,
    currentPlayerId,
    gameState,
    privateState,
    sendMessage,
    solverMode.enabled,
    solverMode.result,
    solverMode.stale,
  ]);

  const currentPlayer = gameState?.players.find(p => p.playerId === currentPlayerId);
  const myTimeBankDecision = gameState?.pendingDecisions.find(
    d => d.playerId === currentPlayerId && d.usingTimeBank,
  );
  const [timeBankRemainingSeconds, setTimeBankRemainingSeconds] = useState(0);

  useEffect(() => {
    if (!myTimeBankDecision) {
      setTimeBankRemainingSeconds(0);
      return;
    }

    const updateRemaining = () => {
      setTimeBankRemainingSeconds(Math.max(0, Math.ceil((myTimeBankDecision.timeoutAt - Date.now()) / 1000)));
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 250);
    return () => clearInterval(interval);
  }, [myTimeBankDecision?.timeoutAt]);

  const showTimeBankDanger =
    screen === 'GAME' &&
    Boolean(myTimeBankDecision) &&
    timeBankRemainingSeconds > 0 &&
    timeBankRemainingSeconds <= TIME_BANK_DANGER_SECONDS &&
    !currentPlayer?.hasFlagged;

  const playerNames: Record<string, string> = {};
  if (gameState) {
    for (const p of gameState.players) {
      playerNames[p.playerId] = p.playerName;
    }
  }

  return (
    <div>
      <TimeBankDangerOverlay active={showTimeBankDanger} remainingSeconds={timeBankRemainingSeconds} />

      {screen === 'NAME' && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="max-w-sm w-full text-center px-6">
            <h1 className="font-display text-4xl font-bold text-sand-800 mb-1">Khora</h1>
            <p className="text-sand-500 italic mb-10">Rise of an Empire</p>
            <p className="text-sand-600 text-sm mb-4">Who are you?</p>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {PLAYER_NAMES.map(name => (
                <button
                  key={name}
                  onClick={() => { setPlayerName(name); setScreen('BROWSE'); }}
                  className="px-4 py-3 bg-gold text-sand-900 rounded-lg font-semibold text-sm hover:bg-gold-dim transition-colors"
                >
                  {name}
                </button>
              ))}
            </div>
            <button
              onClick={() => setScreen('STATS')}
              className="w-full px-4 py-2.5 bg-sand-200 text-sand-700 rounded-lg font-semibold text-sm hover:bg-sand-300 transition-colors"
            >
              View Stats
            </button>
          </div>
        </div>
      )}

      {screen === 'BROWSE' && (
        <div className="flex items-center justify-center min-h-screen">
          <div className="max-w-lg w-full px-6">
            <h1 className="font-display text-2xl font-bold text-sand-800 mb-1 text-center">Khora</h1>
            <p className="text-sand-500 italic mb-8 text-center">Rise of an Empire</p>
            <GameBrowser
              playerName={playerName}
              onCreateGame={handleCreateGame}
              onJoinLobby={handleJoinLobby}
              onReconnectGame={handleReconnectGame}
              error={lobbyError}
            />
          </div>
        </div>
      )}

      {screen === 'STATS' && (
        <StatsPage onBack={() => setScreen('NAME')} />
      )}

      {screen === 'LOBBY' && (
        <LobbyRoom
          players={lobbyPlayers}
          currentPlayerId={currentPlayerId}
          hostPlayerId={hostPlayerId}
          recordStats={recordStats}
          draftMode={draftMode}
          onToggleRecordStats={handleToggleRecordStats}
          onChangeDraftMode={handleChangeDraftMode}
          onStartGame={handleStartGame}
          onBack={handleBackToBrowse}
        />
      )}

      {screen === 'GAME' && !gameState && (
        <div className="flex items-center justify-center min-h-screen">
          <p className="text-sand-600">Connecting to game server{connected ? '...' : ' (waiting)'}</p>
          {wsError && <p className="text-crimson mt-2">{wsError}</p>}
        </div>
      )}

      {screen === 'GAME' && gameState && privateState && (() => {
        // Show end-game summary when game is over
        if (gameState.currentPhase === 'GAME_OVER') {
          const scores = finalScores ?? gameState.finalScores;
          if (scores) {
            return (
              <GameSummary finalScores={scores} gameLog={gameState.gameLog} gameState={gameState} />
            );
          }
        }

        const PHASE_DISPLAY_LABELS: Record<string, string> = {
          OMEN: 'Event Announcement',
          TAXATION: 'Collecting taxes',
          GLORY: 'Event Resolution',
          ACTIONS: 'Actions complete',
        };
        const pending = gameState.pendingDecisions.find(d => d.decisionType !== 'PHASE_DISPLAY') ?? gameState.pendingDecisions[0];
        const isDisplayPhase = pending?.decisionType === 'PHASE_DISPLAY';
        const isMyTurn = !isDisplayPhase && pending?.playerId === currentPlayerId;
        const DECISION_LABELS: Record<string, string> = {
          SELECT_CITY: 'select a city', DRAFT_CARD: 'draft a card', PICK_BAN_CARD: 'pick/ban a card', ROLL_DICE: 'roll dice',
          ASSIGN_DICE: 'assign dice', RESOLVE_ACTION: 'resolve action', PROGRESS_TRACK: 'advance a track',
          ACHIEVEMENT_TRACK_CHOICE: 'choose reward', SPEND_PHILOSOPHY_TOKENS: 'spend tokens',
        };
        let statusText = '';
        if (isDisplayPhase) {
          statusText = PHASE_DISPLAY_LABELS[gameState.currentPhase] ?? '';
        } else if (pending && gameState.currentPhase !== 'GAME_OVER') {
          const who = isMyTurn ? 'Your turn' : `Waiting for ${gameState.players.find(p => p.playerId === pending.playerId)?.playerName ?? '...'}`;
          const action = DECISION_LABELS[pending.decisionType] ?? pending.decisionType;
          statusText = isMyTurn ? `Your turn — ${action}` : `${who} to ${action}`;
        }

        return (
        <div className="grid grid-cols-[320px_1fr_280px] grid-rows-[auto_1fr_auto] gap-3 max-w-[1440px] mx-auto p-3 min-h-screen">

          {gameState.currentPhase === 'CITY_SELECTION' && gameState.cityDraft && (
            <CitySelection
              offeredCities={privateState.offeredCities ?? null}
              pickOrder={gameState.cityDraft.pickOrder}
              currentPickerIndex={gameState.cityDraft.currentPickerIndex}
              selections={gameState.cityDraft.selections}
              allCities={gameState.cityDraft.allCities}
              currentPlayerId={currentPlayerId}
              playerNames={playerNames}
              pendingDecisions={gameState.pendingDecisions}
              onSelectCity={handleSelectCity}
            />
          )}

          {gameState.currentPhase === 'DRAFT_POLITICS' && gameState.politicsDraft && (
            <PoliticsDraft
              draftPack={privateState.draftPack ?? null}
              draftedCards={privateState.draftedCards ?? null}
              draftRound={gameState.politicsDraft.draftRound}
              totalRounds={gameState.politicsDraft.totalRounds}
              waitingFor={gameState.politicsDraft.waitingFor}
              passOrder={gameState.politicsDraft.passOrder}
              currentPlayerId={currentPlayerId}
              playerNames={playerNames}
              pendingDecisions={gameState.pendingDecisions}
              onDraftCard={handleDraftCard}
              cityCard={(() => {
                const player = gameState.players.find(p => p.playerId === currentPlayerId);
                return player?.cityId ? (gameState.cityCards?.[player.cityId] ?? null) : null;
              })()}
              otherPlayerCities={gameState.players
                .filter(p => p.playerId !== currentPlayerId && p.cityId && gameState.cityCards?.[p.cityId])
                .map(p => ({ playerId: p.playerId, playerName: p.playerName, city: gameState.cityCards[p.cityId] }))}
            />
          )}

          {gameState.currentPhase === 'DRAFT_POLITICS' && gameState.pickBanDraft && (
            <PickBanDraft
              allCards={gameState.pickBanDraft.allCards}
              bannedCards={gameState.pickBanDraft.bannedCards}
              pickedCards={gameState.pickBanDraft.pickedCards}
              turnOrder={gameState.pickBanDraft.turnOrder}
              currentTurnIndex={gameState.pickBanDraft.currentTurnIndex}
              phase={gameState.pickBanDraft.phase}
              bansPerPlayer={gameState.pickBanDraft.bansPerPlayer}
              picksPerPlayer={gameState.pickBanDraft.picksPerPlayer}
              currentPlayerId={currentPlayerId}
              playerNames={playerNames}
              pendingDecisions={gameState.pendingDecisions}
              onPickBanCard={handlePickBanCard}
              cityCard={(() => {
                const player = gameState.players.find(p => p.playerId === currentPlayerId);
                return player?.cityId ? (gameState.cityCards?.[player.cityId] ?? null) : null;
              })()}
              otherPlayerCities={gameState.players
                .filter(p => p.playerId !== currentPlayerId && p.cityId && gameState.cityCards?.[p.cityId])
                .map(p => ({ playerId: p.playerId, playerName: p.playerName, city: gameState.cityCards[p.cityId] }))}
            />
          )}

          {gameState.currentPhase !== 'CITY_SELECTION' && gameState.currentPhase !== 'DRAFT_POLITICS' && (
            <LayoutGroup>
            <GameBoard
              gameState={gameState}
              privateState={privateState}
              currentPlayerId={currentPlayerId}
              statusText={statusText}
              isMyTurn={isMyTurn}
              onActivateDev={(devId) => sendMessage({ type: 'ACTIVATE_DEV', devId })}
            >
              {gameState.currentPhase === 'OMEN' && gameState.currentEvent && (
                <div className="py-6">
                  <p className="font-display text-xs uppercase tracking-[0.12em] text-sand-500 mb-4 text-center">Event Announcement</p>
                  <div className="flex justify-center">
                    <motion.div
                      layoutId="event-card"
                      className="inline-block bg-gradient-to-br from-sand-200 to-sand-100 border-2 border-gold rounded-lg px-5 py-4 shadow-lg"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    >
                      <p className="font-display text-lg font-bold text-sand-800 text-center">{gameState.currentEvent.name}</p>
                      <p className="mt-2 font-display text-base font-semibold text-gold-dim leading-snug text-center"
                        style={{ textShadow: '0 0 12px rgba(201,168,76,0.25)' }}
                      >
                        {gameState.currentEvent.gloryCondition.description}
                      </p>
                    </motion.div>
                  </div>
                  <p className="text-xs text-sand-400 mt-5 text-center animate-pulse">Continuing shortly...</p>
                  <StandingsRecap
                    gameState={gameState}
                    currentPlayerId={currentPlayerId}
                    title={`Round ${gameState.roundNumber} Starting Positions`}
                    baseDelay={0.8}
                  />
                </div>
              )}

              {gameState.currentPhase === 'TAXATION' && (() => {
                // Build per-player tax effects
                const taxEffects: Record<string, { text: string; type: 'gain' | 'loss' | 'action' }[]> = {};
                for (const p of gameState.players) {
                  const entries = gameState.gameLog
                    .filter(e => e.roundNumber === gameState.roundNumber && e.phase === 'TAXATION' && e.playerId === p.playerId);
                  const effects: { text: string; type: 'gain' | 'loss' | 'action' }[] = [];
                  const taxIncome = (entries.find(e => e.details?.taxIncome != null)?.details?.taxIncome as number) ?? 0;
                  effects.push({ text: taxIncome > 0 ? `+${taxIncome} coins` : '0 coins', type: taxIncome > 0 ? 'gain' : 'action' });
                  const vpGain = (entries.find(e => e.details?.vpGain != null)?.details?.vpGain as number) ?? 0;
                  if (vpGain > 0) effects.push({ text: `+${vpGain} VP`, type: 'gain' });
                  const troopGain = (entries.find(e => e.details?.troopGain != null)?.details?.troopGain as number) ?? 0;
                  if (troopGain > 0) effects.push({ text: `+${troopGain} troops`, type: 'gain' });
                  const extraCoins = (entries.find(e => e.details?.extraCoins != null)?.details?.extraCoins as number) ?? 0;
                  if (extraCoins > 0) effects.push({ text: `+${extraCoins} coins (cards)`, type: 'gain' });
                  const citizenGain = (entries.find(e => e.details?.citizenGain != null)?.details?.citizenGain as number) ?? 0;
                  if (citizenGain > 0) effects.push({ text: `+${citizenGain} citizens`, type: 'gain' });
                  taxEffects[p.playerId] = effects;
                }
                return (
                  <div className="py-4">
                    <p className="font-display text-xs uppercase tracking-[0.12em] text-sand-500 mb-3 text-center">Tax Collection</p>
                    <p className="text-xs text-sand-400 text-center animate-pulse">Continuing shortly...</p>
                    <StandingsRecap
                      gameState={gameState}
                      currentPlayerId={currentPlayerId}
                      playerEffects={taxEffects}
                      title="After Taxes"
                    />
                  </div>
                );
              })()}

              {gameState.currentPhase === 'GLORY' && gameState.currentEvent && (
                <GloryEventPanel
                  gameState={gameState}
                  privateState={privateState}
                  currentPlayerId={currentPlayerId}
                  currentPlayer={currentPlayer}
                  onResolveAction={handleResolveAction}
                  onSkip={handleSkipPhase}
                  sendMessage={sendMessage}
                />
              )}

              {gameState.currentPhase === 'DICE' && (
                <DicePhase
                  diceRoll={privateState.diceRoll}
                  citizenTrack={currentPlayer?.citizenTrack ?? 0}
                  philosophyTokens={privateState.philosophyTokens}
                  players={gameState.players}
                  currentPlayerId={currentPlayerId}
                  startPlayerId={gameState.startPlayerId}
                  actionSlots={privateState.actionSlots}
                  pendingDecisions={gameState.pendingDecisions}
                  onRoll={handleRollDice}
                  onAssign={handleAssignDice}
                  onUnassign={handleUnassignDice}
                />
              )}

              {gameState.currentPhase === 'ACTIONS' && (() => {
                const hasPendingDecision = gameState.pendingDecisions.some(
                  d => d.playerId === currentPlayerId && d.decisionType === 'RESOLVE_ACTION',
                );
                const nextSlot = hasPendingDecision
                  ? (privateState.actionSlots
                      .filter((s): s is NonNullable<typeof s> => s !== null && !s.resolved)
                      .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType])[0] ?? null)
                  : null;

                return (
                  <div className="space-y-4">
                    {/* Persistent action timeline */}
                    <ActionOverview gameState={gameState} currentPlayerId={currentPlayerId} />

                    {/* Card play announcement */}
                    <CardPlayAnnouncement
                      gameLog={gameState.gameLog}
                      roundNumber={gameState.roundNumber}
                      playerNames={playerNames}
                    />

                    {/* Action controls (when it's your turn) */}
                    {nextSlot && (
                      <div className="border-t border-sand-200 pt-4">
                      <ActionPhase
                        actionType={nextSlot.actionType}
                        handCards={privateState.handCards}
                        playerCoins={privateState.coins}
                        playerEconomyTrack={currentPlayer?.economyTrack ?? 0}
                        playerMilitaryTrack={currentPlayer?.militaryTrack ?? 0}
                        playerTroopTrack={currentPlayer?.troopTrack ?? 0}
                        playerKnowledgeTokens={privateState.knowledgeTokens}
                        philosophyTokens={privateState.philosophyTokens}
                        developmentLevel={currentPlayer?.developmentLevel ?? 0}
                        cityId={currentPlayer?.cityId}
                        cityDevelopments={gameState.cityCards?.[currentPlayer?.cityId ?? '']?.developments}
                        centralBoardTokens={gameState.centralBoardTokens}
                        legislationDraw={privateState.legislationDraw}
                        playedCards={privateState.playedCards}
                        onResolve={handleResolveAction}
                        onSkip={handleSkipPhase}
                        timeoutAt={gameState.pendingDecisions.find(d => d.playerId === currentPlayerId && d.decisionType === 'RESOLVE_ACTION')?.timeoutAt}
                        usingTimeBank={gameState.pendingDecisions.find(d => d.playerId === currentPlayerId && d.decisionType === 'RESOLVE_ACTION')?.usingTimeBank}
                      />
                      </div>
                    )}
                    {!nextSlot && (
                      <WaitingPanel gameState={gameState} privateState={privateState} currentPlayerId={currentPlayerId} />
                    )}
                  </div>
                );
              })()}

              {gameState.currentPhase === 'PROGRESS' && (
                <ProgressPhase
                  gameState={gameState}
                  economyTrack={currentPlayer?.economyTrack ?? 0}
                  cultureTrack={currentPlayer?.cultureTrack ?? 0}
                  militaryTrack={currentPlayer?.militaryTrack ?? 0}
                  coins={privateState.coins}
                  philosophyTokens={privateState.philosophyTokens}
                  pendingDecisions={gameState.pendingDecisions}
                  currentPlayerId={currentPlayerId}
                  playedCardIds={privateState.playedCards.map(c => c.id)}
                  cityId={currentPlayer?.cityId}
                  developmentLevel={currentPlayer?.developmentLevel ?? 0}
                  onAdvance={handleProgressTrack}
                  onUndo={handleUndoProgress}
                  onSkip={handleSkipPhase}
                />
              )}

              {gameState.currentPhase === 'ACHIEVEMENT' && (
                <AchievementPhase
                  gameState={gameState}
                  currentPlayerId={currentPlayerId}
                  onClaim={handleClaimAchievement}
                  onSkip={handleSkipPhase}
                />
              )}
            </GameBoard>
            </LayoutGroup>
          )}
        </div>
        );
      })()}

      {adminPanel === 'cards' && privateState && adminDeckCards && (
        <AdminSwapModal
          handCards={privateState.handCards}
          deckCards={adminDeckCards}
          onSwap={(handCardId, deckCardId) => {
            sendMessage({ type: 'ADMIN_SWAP_CARD', handCardId, deckCardId });
          }}
          onClose={deactivateAdmin}
        />
      )}

      {solverMode.enabled && (
          <SolverPanel
            result={solverMode.result}
            stale={solverMode.stale}
            objective={solverMode.objective}
            onObjectiveChange={solverMode.setObjective}
            displayMode={solverMode.displayMode}
            onDisplayModeChange={solverMode.setDisplayMode}
            status={solverMode.status}
            changeNote={solverMode.changeNote}
            controlMode={cheatControlMode}
            onControlModeChange={setCheatControlMode}
            autopilotLog={cheatLog}
            autopilotPauseReason={autopilotPauseReason}
            onApplyMove={handleApplySolverMove}
            onClose={solverMode.toggle}
          />
      )}

      {adminPanel === 'events' && adminEventCards && (
        <AdminEventModal
          eventCards={adminEventCards}
          unusedEvents={adminUnusedEvents ?? []}
          currentRound={gameState?.roundNumber ?? 1}
          onReorder={(eventOrder) => {
            sendMessage({ type: 'ADMIN_REORDER_EVENTS', eventOrder });
            sendMessage({ type: 'ADMIN_REQUEST_EVENTS' });
          }}
          onClose={deactivateAdmin}
        />
      )}
    </div>
  );
};

export default App;
