import type {
  ActionChoices,
  ActionType,
  ClientMessage,
  DecisionType,
  GamePhase,
  GameState,
  KnowledgeColor,
  KnowledgeRequirement,
  KnowledgeToken,
  LiveSolverMove,
  LiveSolverResult,
  LiveSolverRoundPlan,
  LiveSolverScoreProjection,
  PlayerState,
  PoliticsCard,
  ProgressTrackType,
} from '@khora/shared';
import { ACTION_NUMBERS } from '@khora/shared';
import { GameEngine } from './game-engine';
import { getAllCityCards } from './game-data';
import { calculateFinalScores } from './scoring-engine';
import { calculateDevEndGameScore, hasDevUnlocked } from './city-dev-handlers';

interface SearchOptions {
  timeBudgetMs: number;
  beamWidth: number;
  targetBranches: number;
  opponentBranches: number;
}

interface Candidate {
  message: ClientMessage;
  instruction: string;
  detail: string;
  estimatedSeconds: number;
  quickScore: number;
}

interface SearchNode {
  state: GameState;
  moves: LiveSolverMove[];
  score: number;
}

interface Projection {
  scores: LiveSolverScoreProjection[];
  margin: number | null;
}

const DEFAULT_OPTIONS: SearchOptions = {
  timeBudgetMs: 1400,
  beamWidth: 42,
  targetBranches: 14,
  opponentBranches: 3,
};

const PHASE_ORDER: GamePhase[] = [
  'OMEN',
  'TAXATION',
  'DICE',
  'ACTIONS',
  'PROGRESS',
  'GLORY',
  'ACHIEVEMENT',
];

const PROGRESS_COSTS: Record<ProgressTrackType, Record<number, number>> = {
  ECONOMY: { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4 },
  CULTURE: { 1: 1, 2: 4, 3: 6, 4: 6, 5: 7, 6: 7 },
  MILITARY: { 1: 2, 2: 3, 3: 4, 4: 5, 5: 7, 6: 9 },
};

const ACTION_LABELS: Record<ActionType, string> = {
  PHILOSOPHY: 'Philosophy',
  LEGISLATION: 'Legislation',
  CULTURE: 'Culture',
  TRADE: 'Trade',
  MILITARY: 'Military',
  POLITICS: 'Politics',
  DEVELOPMENT: 'Development',
};

export function runLiveSolver(
  state: GameState,
  playerId: string,
  requestId: string,
  options: Partial<SearchOptions> = {},
): LiveSolverResult {
  const start = Date.now();
  const opts = sanitizeOptions(options);
  const target = state.players.find(p => p.playerId === playerId);

  if (!target) {
    return errorResult(requestId, playerId, start, 'Player not found.');
  }
  if (state.currentPhase === 'CITY_SELECTION' || state.currentPhase === 'DRAFT_POLITICS') {
    return unavailableResult(requestId, playerId, start, 'Live solver starts after city and politics drafting.');
  }
  if (state.currentPhase === 'GAME_OVER') {
    return unavailableResult(requestId, playerId, start, 'Game is already over.');
  }

  let beam: SearchNode[] = [{
    state: cloneGameState(state),
    moves: [],
    score: heuristicScore(state, playerId),
  }];
  let best: SearchNode = beam[0];
  let searchedNodes = 0;
  let completedLines = 0;
  let horizon: LiveSolverResult['horizon'] = 'PARTIAL';

  for (let step = 0; step < 240; step++) {
    if (Date.now() - start >= opts.timeBudgetMs) break;

    const nextBeam: SearchNode[] = [];
    let allComplete = true;

    for (const node of beam) {
      if (Date.now() - start >= opts.timeBudgetMs) break;

      const normalized = normalizeNode(node, playerId);
      searchedNodes += normalized.searched;

      if (normalized.node.state.currentPhase === 'GAME_OVER') {
        completedLines++;
        nextBeam.push(normalized.node);
        continue;
      }

      allComplete = false;
      const decision = pickDecision(normalized.node.state, playerId);
      if (!decision) {
        const advanced = advancePhase(normalized.node.state);
        searchedNodes++;
        nextBeam.push(scoreNode({ ...normalized.node, state: advanced }, playerId));
        continue;
      }

      const candidates = enumerateCandidates(normalized.node.state, decision.playerId, decision.decisionType, playerId)
        .slice(0, decision.playerId === playerId ? opts.targetBranches : opts.opponentBranches);

      const usableCandidates = candidates.length > 0
        ? candidates
        : fallbackCandidates(normalized.node.state, decision.playerId, decision.decisionType);

      for (const candidate of usableCandidates) {
        const applied = applyMessage(normalized.node.state, decision.playerId, candidate.message);
        searchedNodes++;
        if (!applied) continue;

        const moves = decision.playerId === playerId
          ? [
              ...normalized.node.moves,
              buildMove(normalized.node.state, decision.playerId, decision.decisionType, candidate),
            ]
          : normalized.node.moves;

        nextBeam.push(scoreNode({ state: applied, moves, score: 0 }, playerId));
      }
    }

    if (nextBeam.length === 0) break;

    nextBeam.sort((a, b) => b.score - a.score);
    beam = diversify(nextBeam, opts.beamWidth);
    if (beam[0] && beam[0].score >= best.score) best = beam[0];
    if (allComplete) {
      horizon = 'FULL_GAME';
      break;
    }
  }

  const finalBest = normalizeNode(best, playerId).node;
  const projection = projectScores(finalBest.state, playerId);
  const currentMove = finalBest.moves[0] ?? null;

  return {
    requestId,
    playerId,
    generatedAt: Date.now(),
    status: 'READY',
    message: horizon === 'FULL_GAME'
      ? 'Full-game line searched to final scoring.'
      : 'Partial line returned because the timer budget was reached.',
    currentMove,
    rounds: groupMovesByRound(finalBest.moves),
    projections: projection.scores,
    projectedMargin: projection.margin,
    searchedNodes,
    completedLines,
    computeMs: Date.now() - start,
    horizon,
  };
}

function sanitizeOptions(options: Partial<SearchOptions>): SearchOptions {
  return {
    timeBudgetMs: clampNumber(options.timeBudgetMs, 250, 5000, DEFAULT_OPTIONS.timeBudgetMs),
    beamWidth: clampNumber(options.beamWidth, 8, 120, DEFAULT_OPTIONS.beamWidth),
    targetBranches: clampNumber(options.targetBranches, 4, 40, DEFAULT_OPTIONS.targetBranches),
    opponentBranches: clampNumber(options.opponentBranches, 1, 10, DEFAULT_OPTIONS.opponentBranches),
  };
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeNode(node: SearchNode, playerId: string): { node: SearchNode; searched: number } {
  let current = node;
  let searched = 0;
  for (let i = 0; i < 40; i++) {
    const display = current.state.pendingDecisions.find(d => d.decisionType === 'PHASE_DISPLAY');
    if (!display) break;
    const state = autoResolve(current.state, display.playerId);
    searched++;
    current = scoreNode({ ...current, state }, playerId);
    if (current.state.currentPhase === 'GAME_OVER') break;
  }
  return { node: current, searched };
}

function pickDecision(state: GameState, targetPlayerId: string): GameState['pendingDecisions'][number] | null {
  const real = state.pendingDecisions.filter(d => d.decisionType !== 'PHASE_DISPLAY');
  if (real.length === 0) return null;
  return real.find(d => d.playerId === targetPlayerId) ?? real[0];
}

function enumerateCandidates(
  state: GameState,
  actorId: string,
  decisionType: DecisionType,
  targetPlayerId: string,
): Candidate[] {
  const actor = state.players.find(p => p.playerId === actorId);
  if (!actor) return [];

  let candidates: Candidate[] = [];
  switch (decisionType) {
    case 'ROLL_DICE':
      candidates = [{
        message: { type: 'ROLL_DICE' },
        instruction: 'Roll dice',
        detail: 'Reveal the scheduled dice for this round.',
        estimatedSeconds: 1,
        quickScore: 0,
      }];
      break;
    case 'ASSIGN_DICE':
      candidates = enumerateDiceAssignments(state, actor);
      break;
    case 'RESOLVE_ACTION':
      candidates = enumerateActionResolution(state, actor);
      break;
    case 'PROGRESS_TRACK':
      candidates = enumerateProgress(state, actor);
      break;
    case 'ACHIEVEMENT_TRACK_CHOICE':
      candidates = enumerateAchievementChoices(actor);
      break;
    case 'SELECT_CITY':
      candidates = enumerateCityChoices(state, actorId);
      break;
    case 'DRAFT_CARD':
      candidates = enumerateDraftChoices(state, actorId, 'DRAFT_CARD');
      break;
    case 'PICK_BAN_CARD':
      candidates = enumerateDraftChoices(state, actorId, 'PICK_BAN_CARD');
      break;
    case 'ORACLE_CHOOSE_TOKEN':
      candidates = enumerateOracleChoices(actor);
      break;
    case 'MILITARY_VICTORY_PROGRESS':
      candidates = enumerateEventProgress(actor, ['ECONOMY', 'CULTURE', 'MILITARY'], 'Military Victory');
      break;
    case 'RISE_OF_PERSIA_PROGRESS':
      candidates = enumerateEventProgress(actor, ['MILITARY'], 'Rise of Persia');
      break;
    case 'THIRTY_TYRANTS_DISCARD':
      candidates = enumerateDiscardChoices(actor);
      break;
    case 'PROSPERITY_POLITICS':
      candidates = enumeratePoliticsCards(state, actor, 'Prosperity politics');
      break;
    case 'CONQUEST_ACTION':
      candidates = enumerateConquestActions(state, actor);
      break;
    default:
      candidates = [];
  }

  const scored = candidates
    .map(candidate => ({
      candidate,
      score: candidate.quickScore + candidateOutcomeScore(state, actorId, candidate, targetPlayerId),
    }))
    .sort((a, b) => b.score - a.score)
    .map(x => x.candidate);

  return scored;
}

function fallbackCandidates(state: GameState, actorId: string, decisionType: DecisionType): Candidate[] {
  if (decisionType === 'RESOLVE_ACTION') {
    const actor = state.players.find(p => p.playerId === actorId);
    const action = actor ? nextAction(actor) : null;
    if (action && ['LEGISLATION', 'POLITICS', 'DEVELOPMENT'].includes(action)) {
      return [{
        message: { type: 'SKIP_PHASE' },
        instruction: `Skip ${ACTION_LABELS[action]} action`,
        detail: 'No reliable candidate was found for this optional action.',
        estimatedSeconds: 1,
        quickScore: -50,
      }];
    }
  }
  return [{
    message: { type: 'SKIP_PHASE' },
    instruction: 'Skip',
    detail: `Fallback for ${decisionType}.`,
    estimatedSeconds: 1,
    quickScore: -100,
  }];
}

function enumerateDiceAssignments(state: GameState, actor: PlayerState): Candidate[] {
  const dice = actor.diceRoll ?? state.predeterminedDice[state.roundNumber]?.[actor.playerId] ?? [];
  if (dice.length === 0) return [];

  const actionTypes = (Object.keys(ACTION_NUMBERS) as ActionType[])
    .filter(action => actionLikelyUseful(state, actor, action));
  const combos = combinations(actionTypes, dice.length);
  const candidates: Candidate[] = [];

  for (const actions of combos) {
    const assignments = bestDicePairing(dice, actions);
    const citizenCost = assignments.reduce((sum, assignment) =>
      sum + Math.max(0, ACTION_NUMBERS[assignment.actionType] - assignment.dieValue), 0);
    const maxScrolls = Math.min(actor.philosophyTokens, Math.ceil(Math.max(0, citizenCost - actor.citizenTrack) / 3));
    for (let spend = 0; spend <= maxScrolls; spend++) {
      if (citizenCost > actor.citizenTrack + spend * 3) continue;
      const message: ClientMessage = {
        type: 'ASSIGN_DICE',
        assignments,
        philosophyTokensToSpend: spend > 0 ? spend : undefined,
      };
      const actionNames = assignments
        .slice()
        .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType])
        .map(a => `${a.dieValue} to ${ACTION_LABELS[a.actionType]}`);
      candidates.push({
        message,
        instruction: `Assign ${joinNatural(actionNames)}`,
        detail: spend > 0
          ? `Spend ${spend} scroll${spend === 1 ? '' : 's'} first to cover citizen cost ${citizenCost}.`
          : `Citizen cost ${citizenCost}.`,
        estimatedSeconds: 8,
        quickScore: actions.reduce((sum, action) => sum + actionPriority(actor, action), 0) - citizenCost * 1.5 - spend * 0.75,
      });
    }
  }

  return candidates;
}

function bestDicePairing(dice: number[], actions: ActionType[]): Array<{ slotIndex: 0 | 1 | 2; actionType: ActionType; dieValue: number }> {
  const sortedDice = [...dice].sort((a, b) => b - a);
  const sortedActions = [...actions].sort((a, b) => ACTION_NUMBERS[b] - ACTION_NUMBERS[a]);
  return sortedActions.map((actionType, index) => ({
    slotIndex: index as 0 | 1 | 2,
    actionType,
    dieValue: sortedDice[index],
  }));
}

function enumerateActionResolution(state: GameState, actor: PlayerState): Candidate[] {
  const action = nextAction(actor);
  if (!action) return [];
  switch (action) {
    case 'PHILOSOPHY':
    case 'CULTURE':
      return [{
        message: { type: 'RESOLVE_ACTION', actionType: action, choices: {} },
        instruction: `Resolve ${ACTION_LABELS[action]}`,
        detail: action === 'PHILOSOPHY' ? 'Gain 1 scroll.' : `Gain ${actor.cultureTrack} VP.`,
        estimatedSeconds: 2,
        quickScore: actionPriority(actor, action),
      }];
    case 'TRADE':
      return enumerateTrade(actor);
    case 'MILITARY':
      return enumerateMilitary(state, actor);
    case 'LEGISLATION':
      return enumerateLegislation(state);
    case 'POLITICS':
      return enumeratePoliticsCards(state, actor, 'Politics');
    case 'DEVELOPMENT':
      return enumerateDevelopment(state, actor);
  }
}

function enumerateTrade(actor: PlayerState): Candidate[] {
  const afterIncome = actor.coins + actor.economyTrack + 1;
  const tokenCost = hasCard(actor, 'corinthian-columns') ? 3 : 5;
  const candidates: Candidate[] = [{
    message: { type: 'RESOLVE_ACTION', actionType: 'TRADE', choices: {} },
    instruction: 'Trade for drachma',
    detail: `Gain ${actor.economyTrack + 1} drachma.`,
    estimatedSeconds: 3,
    quickScore: actor.economyTrack + 1,
  }];

  if (afterIncome >= tokenCost) {
    for (const color of rankedKnowledgeColors(actor)) {
      candidates.push({
        message: {
          type: 'RESOLVE_ACTION',
          actionType: 'TRADE',
          choices: { buyMinorKnowledge: true, minorKnowledgeColor: color },
        },
        instruction: `Trade and buy ${formatColor(color)} minor`,
        detail: `Gain ${actor.economyTrack + 1} drachma, then spend ${tokenCost} on a ${formatColor(color)} minor token.`,
        estimatedSeconds: 5,
        quickScore: actor.economyTrack + 6 + knowledgeColorNeed(actor, color),
      });
    }
  }

  return candidates;
}

function enumerateMilitary(state: GameState, actor: PlayerState): Candidate[] {
  const troopAfterGain = actor.troopTrack + actor.militaryTrack;
  const candidates: Candidate[] = [{
    message: { type: 'RESOLVE_ACTION', actionType: 'MILITARY', choices: {} },
    instruction: 'Military without exploring',
    detail: `Gain ${actor.militaryTrack} troops.`,
    estimatedSeconds: 3,
    quickScore: actor.militaryTrack,
  }];

  const explorable = state.centralBoardTokens
    .filter(t => !t.explored && canExploreToken(actor, t, troopAfterGain))
    .sort((a, b) => tokenValue(b) - tokenValue(a))
    .slice(0, hasDevUnlocked(actor, 'thebes-dev-3') ? 5 : 4);

  for (const token of explorable) {
    candidates.push({
      message: {
        type: 'RESOLVE_ACTION',
        actionType: 'MILITARY',
        choices: { explorationTokenId: token.id },
      },
      instruction: `Military: explore ${tokenLabel(token)}`,
      detail: `Gain ${actor.militaryTrack} troops, then take ${tokenLabel(token)}.`,
      estimatedSeconds: 8,
      quickScore: actor.militaryTrack + tokenValue(token),
    });
  }

  if (hasDevUnlocked(actor, 'thebes-dev-3') && explorable.length >= 2) {
    for (let i = 0; i < Math.min(3, explorable.length); i++) {
      for (let j = 0; j < Math.min(3, explorable.length); j++) {
        if (i === j) continue;
        const first = explorable[i];
        const second = explorable[j];
        candidates.push({
          message: {
            type: 'RESOLVE_ACTION',
            actionType: 'MILITARY',
            choices: { explorationTokenId: first.id, secondExplorationTokenId: second.id },
          },
          instruction: `Military: explore ${tokenLabel(first)}, then ${tokenLabel(second)}`,
          detail: 'Uses Thebes development to explore twice.',
          estimatedSeconds: 12,
          quickScore: actor.militaryTrack + tokenValue(first) + tokenValue(second),
        });
      }
    }
  }

  return candidates;
}

function enumerateLegislation(state: GameState): Candidate[] {
  return state.politicsDeck.slice(0, 2).map(card => ({
    message: { type: 'RESOLVE_ACTION', actionType: 'LEGISLATION', choices: { targetCardId: card.id } },
    instruction: `Legislation: keep ${card.name}`,
    detail: 'Gain 3 citizens and keep this card from the draw.',
    estimatedSeconds: 6,
    quickScore: cardValue(card),
  }));
}

function enumeratePoliticsCards(state: GameState, actor: PlayerState, source: string): Candidate[] {
  return actor.handCards
    .map(card => politicsCandidate(state, actor, card, source))
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((a, b) => b.quickScore - a.quickScore)
    .slice(0, 8);
}

function politicsCandidate(state: GameState, actor: PlayerState, card: PoliticsCard, source: string): Candidate | null {
  if (actor.coins < card.cost) return null;
  const pairs = knowledgeShortfall(actor, card.knowledgeRequirement);
  if (pairs * 2 > actor.philosophyTokens) return null;

  const choices: ActionChoices = {
    targetCardId: card.id,
    philosophyPairsToUse: pairs > 0 ? pairs : undefined,
  };
  if (card.id === 'scholarly-welcome') {
    choices.scholarlyWelcomeColor = rankedKnowledgeColors(actor)[0];
  }
  if (card.id === 'ostracism' && actor.playedCards.length > 0) {
    choices.ostracismReturnCardId = [...actor.playedCards].sort((a, b) => cardValue(b) - cardValue(a))[0].id;
  }

  return {
    message: { type: 'RESOLVE_ACTION', actionType: 'POLITICS', choices },
    instruction: `${source}: play ${card.name}`,
    detail: [
      card.cost > 0 ? `Pay ${card.cost} drachma` : 'Free card',
      pairs > 0 ? `spend ${pairs * 2} scrolls for missing knowledge` : 'requirements met',
    ].join('; '),
    estimatedSeconds: 10,
    quickScore: cardValue(card) - card.cost - pairs * 2,
  };
}

function enumerateDevelopment(state: GameState, actor: PlayerState): Candidate[] {
  const city = getAllCityCards().find(c => c.id === actor.cityId);
  const dev = city?.developments[actor.developmentLevel] ?? null;
  if (!dev || actor.coins < dev.drachmaCost) return [];
  const pairs = knowledgeShortfall(actor, dev.knowledgeRequirement);
  if (pairs * 2 > actor.philosophyTokens) return [];

  const baseChoices: ActionChoices = {
    philosophyPairsToUse: pairs > 0 ? pairs : undefined,
  };
  const choicesList: ActionChoices[] = [baseChoices];

  if (dev.id === 'miletus-dev-2') {
    choicesList.splice(0, choicesList.length,
      { ...baseChoices, devTrackChoices: ['ECONOMY', 'CULTURE'] },
      { ...baseChoices, devTrackChoices: ['ECONOMY', 'MILITARY'] },
      { ...baseChoices, devTrackChoices: ['CULTURE', 'MILITARY'] },
    );
  }
  if (dev.id === 'argos-dev-2') {
    choicesList.splice(0, choicesList.length,
      { ...baseChoices, argosDevReward: 'vp' },
      { ...baseChoices, argosDevReward: 'coins' },
      { ...baseChoices, argosDevReward: 'citizens' },
      { ...baseChoices, argosDevReward: 'troops' },
    );
  }
  if (dev.id === 'sparta-dev-3') {
    const tokens = state.centralBoardTokens
      .filter(t => !t.explored)
      .sort((a, b) => tokenValue(b) - tokenValue(a))
      .slice(0, 3);
    choicesList.splice(0, choicesList.length, baseChoices);
    if (tokens[0]) choicesList.push({ ...baseChoices, spartaMilitaryTokenIds: [tokens[0].id] });
    if (tokens[0] && tokens[1]) choicesList.push({ ...baseChoices, spartaMilitaryTokenIds: [tokens[0].id, tokens[1].id] });
  }

  return choicesList.map(choices => ({
    message: { type: 'RESOLVE_ACTION', actionType: 'DEVELOPMENT', choices },
    instruction: `Develop: ${dev.name}`,
    detail: [
      dev.drachmaCost > 0 ? `Pay ${dev.drachmaCost} drachma` : 'No drachma cost',
      pairs > 0 ? `spend ${pairs * 2} scrolls for missing knowledge` : 'requirements met',
    ].join('; '),
    estimatedSeconds: 10,
    quickScore: 14 + dev.level * 7 - dev.drachmaCost - pairs,
  }));
}

function enumerateProgress(_state: GameState, actor: PlayerState): Candidate[] {
  const candidates: Candidate[] = [{
    message: { type: 'SKIP_PHASE' },
    instruction: 'Skip progress',
    detail: hasCard(actor, 'old-guard') ? 'Old Guard scores 4 VP for skipping.' : 'Save drachma for later.',
    estimatedSeconds: 2,
    quickScore: hasCard(actor, 'old-guard') ? 6 : -4,
  }];
  const bonusCount = (hasCard(actor, 'reformists') ? 1 : 0) + (hasDevUnlocked(actor, 'corinth-dev-3') ? 1 : 0);

  for (const primary of ['ECONOMY', 'CULTURE', 'MILITARY'] as ProgressTrackType[]) {
    const afterPrimary = virtualAdvanceProgress(actor, primary);
    if (!afterPrimary) continue;
    candidates.push({
      message: { type: 'PROGRESS_TRACK', advancement: { track: primary } },
      instruction: `Advance ${formatTrack(primary)}`,
      detail: `Pay ${progressCost(actor, primary)} drachma.`,
      estimatedSeconds: 5,
      quickScore: progressValue(actor, primary),
    });

    if (actor.philosophyTokens > 0) {
      for (const extra of ['ECONOMY', 'CULTURE', 'MILITARY'] as ProgressTrackType[]) {
        const afterExtra = virtualAdvanceProgress(afterPrimary, extra);
        if (!afterExtra) continue;
        candidates.push({
          message: {
            type: 'PROGRESS_TRACK',
            advancement: { track: primary },
            extraTracks: [{ track: extra }],
          },
          instruction: `Advance ${formatTrack(primary)}, then ${formatTrack(extra)} with a scroll`,
          detail: `Spend 1 scroll and pay both drachma costs.`,
          estimatedSeconds: 8,
          quickScore: progressValue(actor, primary) + progressValue(afterPrimary, extra) - 1,
        });
      }
    }

    if (bonusCount > 0) {
      for (const bonus of ['ECONOMY', 'CULTURE', 'MILITARY'] as ProgressTrackType[]) {
        const afterBonus = virtualAdvanceProgress(afterPrimary, bonus);
        if (!afterBonus) continue;
        candidates.push({
          message: {
            type: 'PROGRESS_TRACK',
            advancement: { track: primary },
            bonusTracks: [{ track: bonus }],
          },
          instruction: `Advance ${formatTrack(primary)} plus bonus ${formatTrack(bonus)}`,
          detail: 'Uses Reformists or Corinth development bonus progress.',
          estimatedSeconds: 8,
          quickScore: progressValue(actor, primary) + progressValue(afterPrimary, bonus),
        });
      }
    }
  }

  return candidates;
}

function enumerateAchievementChoices(actor: PlayerState): Candidate[] {
  const gloryValue = actor.knowledgeTokens.filter(t => t.tokenType === 'MAJOR').length + 1;
  return [
    {
      message: { type: 'CLAIM_ACHIEVEMENT', achievementId: '', trackChoice: 'GLORY' },
      instruction: 'Achievement: choose +1 Glory',
      detail: 'Improves end-game major-token scoring.',
      estimatedSeconds: 3,
      quickScore: gloryValue,
    },
    {
      message: { type: 'CLAIM_ACHIEVEMENT', achievementId: '', trackChoice: 'TAX' },
      instruction: 'Achievement: choose +1 Tax',
      detail: 'Improves future income.',
      estimatedSeconds: 3,
      quickScore: 2,
    },
  ];
}

function enumerateCityChoices(state: GameState, actorId: string): Candidate[] {
  const cityDraft = state.draftState?.cityDraft;
  const offeredIds = cityDraft?.offeredCities[actorId] ?? [];
  const offered = cityDraft?.allCities.filter(c => offeredIds.includes(c.id)) ?? [];
  return offered.map(city => ({
    message: { type: 'SELECT_CITY', cityId: city.id },
    instruction: `Select ${city.name}`,
    detail: 'Highest projected city value among offered choices.',
    estimatedSeconds: 5,
    quickScore: city.startingCoins + city.startingTracks.economy * 3 + city.startingTracks.culture * 3 + city.startingTracks.military * 2,
  }));
}

function enumerateDraftChoices(state: GameState, actorId: string, type: 'DRAFT_CARD' | 'PICK_BAN_CARD'): Candidate[] {
  if (type === 'DRAFT_CARD') {
    const pack = state.draftState?.politicsDraft?.packs[actorId] ?? [];
    return pack.map(card => ({
      message: { type: 'DRAFT_CARD', cardId: card.id },
      instruction: `Draft ${card.name}`,
      detail: card.description,
      estimatedSeconds: 5,
      quickScore: cardValue(card),
    }));
  }
  const draft = state.draftState?.pickBanDraft;
  if (!draft) return [];
  const action = draft.phase;
  const unavailable = new Set([
    ...Object.values(draft.bannedCards).flatMap(cards => cards.map(c => c.id)),
    ...Object.values(draft.pickedCards).flatMap(cards => cards.map(c => c.id)),
  ]);
  return draft.allCards
    .filter(card => !unavailable.has(card.id))
    .map(card => ({
      message: { type: 'PICK_BAN_CARD', cardId: card.id, action },
      instruction: `${action === 'BAN' ? 'Ban' : 'Pick'} ${card.name}`,
      detail: card.description,
      estimatedSeconds: 5,
      quickScore: action === 'BAN' ? cardValue(card) * 0.8 : cardValue(card),
    }));
}

function enumerateOracleChoices(actor: PlayerState): Candidate[] {
  return actor.knowledgeTokens
    .map((token): Candidate => ({
      message: { type: 'CHOOSE_TOKEN' as const, tokenId: token.id },
      instruction: `Oracle: lose ${tokenLabel(token)}`,
      detail: 'Lose this token and gain 2 scrolls.',
      estimatedSeconds: 5,
      quickScore: -tokenValue(token),
    }))
    .sort((a, b) => b.quickScore - a.quickScore);
}

function enumerateEventProgress(actor: PlayerState, tracks: ProgressTrackType[], source: string): Candidate[] {
  return tracks
    .filter(track => actor[trackField(track)] < 7)
    .map(track => ({
      message: { type: 'EVENT_PROGRESS_TRACK', track },
      instruction: `${source}: advance ${formatTrack(track)}`,
      detail: 'Uses the event progress discount.',
      estimatedSeconds: 5,
      quickScore: progressValue(actor, track),
    }));
}

function enumerateDiscardChoices(actor: PlayerState): Candidate[] {
  const count = Math.min(2, actor.handCards.length);
  if (count <= 0) return [{ message: { type: 'SKIP_PHASE' }, instruction: 'Skip discard', detail: 'No cards to discard.', estimatedSeconds: 1, quickScore: 0 }];
  const discard = [...actor.handCards].sort((a, b) => cardValue(a) - cardValue(b)).slice(0, count);
  return [{
    message: { type: 'DISCARD_CARDS', cardIds: discard.map(c => c.id) },
    instruction: `Discard ${joinNatural(discard.map(c => c.name))}`,
    detail: 'Lowest projected card value in hand.',
    estimatedSeconds: 8,
    quickScore: -discard.reduce((sum, card) => sum + cardValue(card), 0),
  }];
}

function enumerateConquestActions(state: GameState, actor: PlayerState): Candidate[] {
  const candidates: Candidate[] = [
    ...enumerateLegislation(state),
    ...enumerateTrade(actor),
    ...enumeratePoliticsCards(state, actor, 'Conquest politics'),
    ...enumerateDevelopment(state, actor),
    {
      message: { type: 'RESOLVE_ACTION' as const, actionType: 'PHILOSOPHY' as const, choices: {} },
      instruction: 'Conquest: take Philosophy',
      detail: 'Gain 1 scroll.',
      estimatedSeconds: 3,
      quickScore: 3,
    },
    {
      message: { type: 'RESOLVE_ACTION' as const, actionType: 'CULTURE' as const, choices: {} },
      instruction: 'Conquest: take Culture',
      detail: `Gain ${actor.cultureTrack} VP.`,
      estimatedSeconds: 3,
      quickScore: actor.cultureTrack,
    },
  ];
  return candidates.filter(candidate =>
    candidate.message.type !== 'RESOLVE_ACTION' || candidate.message.actionType !== 'MILITARY');
}

function candidateOutcomeScore(state: GameState, actorId: string, candidate: Candidate, targetPlayerId: string): number {
  const applied = applyMessage(state, actorId, candidate.message);
  if (!applied) return -10000;
  const actor = state.players.find(p => p.playerId === actorId);
  const targetWeight = actorId === targetPlayerId ? 1 : -0.2;
  const before = actor ? roughPlayerScore(actor) : 0;
  const after = applied.players.find(p => p.playerId === actorId);
  const delta = after ? roughPlayerScore(after) - before : 0;
  return delta * targetWeight;
}

function applyMessage(state: GameState, actorId: string, message: ClientMessage): GameState | null {
  try {
    const engine = new GameEngine(state.draftMode);
    const machine = engine.getStateMachine();
    machine.currentPhase = state.currentPhase;
    machine.roundNumber = state.roundNumber;
    const result = engine.handlePlayerDecision(cloneGameState(state), actorId, message);
    return result.ok ? result.value : null;
  } catch {
    return null;
  }
}

function autoResolve(state: GameState, actorId: string): GameState {
  try {
    const engine = new GameEngine(state.draftMode);
    const machine = engine.getStateMachine();
    machine.currentPhase = state.currentPhase;
    machine.roundNumber = state.roundNumber;
    return engine.handleTimeout(cloneGameState(state), actorId);
  } catch {
    return state;
  }
}

function advancePhase(state: GameState): GameState {
  try {
    const engine = new GameEngine(state.draftMode);
    const machine = engine.getStateMachine();
    machine.currentPhase = state.currentPhase;
    machine.roundNumber = state.roundNumber;
    return engine.advancePhase(cloneGameState(state));
  } catch {
    return state;
  }
}

function buildMove(state: GameState, actorId: string, decisionType: DecisionType, candidate: Candidate): LiveSolverMove {
  const actor = state.players.find(p => p.playerId === actorId);
  return {
    round: state.roundNumber,
    phase: state.currentPhase,
    playerId: actorId,
    playerName: actor?.playerName ?? actorId,
    decisionType,
    instruction: candidate.instruction,
    detail: candidate.detail,
    message: candidate.message,
    estimatedSeconds: candidate.estimatedSeconds,
  };
}

function groupMovesByRound(moves: LiveSolverMove[]): LiveSolverRoundPlan[] {
  const map = new Map<number, LiveSolverMove[]>();
  for (const move of moves) {
    const roundMoves = map.get(move.round) ?? [];
    roundMoves.push(move);
    map.set(move.round, roundMoves);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([round, roundMoves]) => ({ round, moves: roundMoves }));
}

function scoreNode(node: SearchNode, targetPlayerId: string): SearchNode {
  return { ...node, score: heuristicScore(node.state, targetPlayerId) };
}

function heuristicScore(state: GameState, targetPlayerId: string): number {
  const target = state.players.find(p => p.playerId === targetPlayerId);
  if (!target) return -Infinity;
  const targetScore = roughPlayerScore(target);
  const opponentScore = Math.max(0, ...state.players
    .filter(p => p.playerId !== targetPlayerId)
    .map(roughPlayerScore));
  const phaseProgress = PHASE_ORDER.indexOf(state.currentPhase);
  return (targetScore - opponentScore) * 3 + targetScore + state.roundNumber * 0.05 + phaseProgress * 0.01;
}

function roughPlayerScore(player: PlayerState): number {
  const majors = player.knowledgeTokens.filter(t => t.tokenType === 'MAJOR').length;
  const currentFinalish =
    player.victoryPoints
    + calculateDevEndGameScore(player)
    + player.gloryTrack * majors
    + player.playedCards.reduce((sum, card) => sum + roughEndGameCardScore(card, player), 0);
  return currentFinalish
    + player.coins * 0.25
    + player.philosophyTokens * 0.8
    + player.citizenTrack * 0.18
    + player.economyTrack * 1.4
    + player.cultureTrack * 1.6
    + player.militaryTrack * 1.25
    + player.taxTrack * 1.2
    + player.gloryTrack * 0.7
    + player.handCards.reduce((sum, card) => sum + cardValue(card) * 0.12, 0);
}

function roughEndGameCardScore(card: PoliticsCard, player: PlayerState): number {
  if (card.type !== 'END_GAME' || !card.endGameScoring) return 0;
  try {
    return card.endGameScoring.calculate(player);
  } catch {
    return 0;
  }
}

function projectScores(state: GameState, targetPlayerId: string): Projection {
  const board = state.currentPhase === 'GAME_OVER' && state.finalScores
    ? state.finalScores
    : calculateFinalScores(state);
  const scores = board.rankings.map(score => ({
    playerId: score.playerId,
    playerName: score.playerName,
    projectedTotal: score.totalPoints,
    rank: score.rank,
  }));
  const target = scores.find(score => score.playerId === targetPlayerId);
  const bestOpponent = scores
    .filter(score => score.playerId !== targetPlayerId)
    .sort((a, b) => b.projectedTotal - a.projectedTotal)[0];
  return {
    scores,
    margin: target && bestOpponent ? target.projectedTotal - bestOpponent.projectedTotal : null,
  };
}

function diversify(nodes: SearchNode[], limit: number): SearchNode[] {
  const selected: SearchNode[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const key = stateSignature(node.state);
    if (seen.has(key) && selected.length >= Math.ceil(limit / 2)) continue;
    seen.add(key);
    selected.push(node);
    if (selected.length >= limit) break;
  }
  return selected;
}

function stateSignature(state: GameState): string {
  return JSON.stringify({
    phase: state.currentPhase,
    round: state.roundNumber,
    pending: state.pendingDecisions.map(d => `${d.playerId}:${d.decisionType}`),
    players: state.players.map(p => [
      p.playerId, p.coins, p.victoryPoints, p.economyTrack, p.cultureTrack, p.militaryTrack,
      p.taxTrack, p.gloryTrack, p.troopTrack, p.citizenTrack, p.philosophyTokens,
      p.handCards.map(c => c.id).join(','),
      p.playedCards.map(c => c.id).join(','),
      p.knowledgeTokens.map(t => t.id).join(','),
    ]),
    deck: state.politicsDeck.slice(0, 4).map(c => c.id),
    tokens: state.centralBoardTokens.filter(t => !t.explored).slice(0, 6).map(t => t.id),
  });
}

function cloneGameState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map(clonePlayer),
    predeterminedDice: Object.fromEntries(Object.entries(state.predeterminedDice).map(([round, playerDice]) => [
      round,
      Object.fromEntries(Object.entries(playerDice).map(([pid, dice]) => [pid, [...dice]])),
    ])),
    eventDeck: [...state.eventDeck],
    politicsDeck: [...state.politicsDeck],
    centralBoardTokens: state.centralBoardTokens.map(t => ({ ...t })),
    availableAchievements: [...state.availableAchievements],
    claimedAchievements: new Map(Array.from(state.claimedAchievements.entries()).map(([pid, achievements]) => [pid, [...achievements]])),
    pendingDecisions: state.pendingDecisions.map(d => ({ ...d })),
    disconnectedPlayers: new Map(state.disconnectedPlayers),
    draftState: state.draftState ? {
      cityDraft: state.draftState.cityDraft ? {
        ...state.draftState.cityDraft,
        offeredCities: Object.fromEntries(Object.entries(state.draftState.cityDraft.offeredCities).map(([pid, ids]) => [pid, [...ids]])),
        remainingPool: [...state.draftState.cityDraft.remainingPool],
        selections: { ...state.draftState.cityDraft.selections },
        allCities: [...state.draftState.cityDraft.allCities],
      } : null,
      politicsDraft: state.draftState.politicsDraft ? {
        ...state.draftState.politicsDraft,
        packs: Object.fromEntries(Object.entries(state.draftState.politicsDraft.packs).map(([pid, cards]) => [pid, [...cards]])),
        selectedCards: Object.fromEntries(Object.entries(state.draftState.politicsDraft.selectedCards).map(([pid, cards]) => [pid, [...cards]])),
        waitingFor: [...state.draftState.politicsDraft.waitingFor],
        passOrder: [...state.draftState.politicsDraft.passOrder],
      } : null,
      pickBanDraft: state.draftState.pickBanDraft ? {
        ...state.draftState.pickBanDraft,
        allCards: [...state.draftState.pickBanDraft.allCards],
        bannedCards: Object.fromEntries(Object.entries(state.draftState.pickBanDraft.bannedCards).map(([pid, cards]) => [pid, [...cards]])),
        pickedCards: Object.fromEntries(Object.entries(state.draftState.pickBanDraft.pickedCards).map(([pid, cards]) => [pid, [...cards]])),
        turnOrder: [...state.draftState.pickBanDraft.turnOrder],
      } : null,
    } : null,
    finalScores: state.finalScores ? {
      winnerId: state.finalScores.winnerId,
      rankings: state.finalScores.rankings.map(r => ({ ...r, breakdown: { ...r.breakdown, detailedSources: [...r.breakdown.detailedSources] } })),
    } : null,
  };
}

function clonePlayer(player: PlayerState): PlayerState {
  return {
    ...player,
    knowledgeTokens: player.knowledgeTokens.map(t => ({ ...t })),
    handCards: [...player.handCards],
    playedCards: [...player.playedCards],
    diceRoll: player.diceRoll ? [...player.diceRoll] : null,
    diceRollHistory: [...(player.diceRollHistory ?? [])],
    actionSlots: player.actionSlots.map(slot => slot ? { ...slot } : null) as PlayerState['actionSlots'],
  };
}

function nextAction(player: PlayerState): ActionType | null {
  return player.actionSlots
    .filter((slot): slot is NonNullable<typeof slot> => slot !== null && !slot.resolved)
    .sort((a, b) => ACTION_NUMBERS[a.actionType] - ACTION_NUMBERS[b.actionType])[0]?.actionType ?? null;
}

function actionLikelyUseful(state: GameState, actor: PlayerState, action: ActionType): boolean {
  if (action === 'LEGISLATION') return state.politicsDeck.length > 0;
  if (action === 'POLITICS') return actor.handCards.some(card => politicsCandidate(state, actor, card, 'Politics') !== null);
  if (action === 'DEVELOPMENT') return enumerateDevelopment(state, actor).length > 0;
  return true;
}

function actionPriority(actor: PlayerState, action: ActionType): number {
  switch (action) {
    case 'PHILOSOPHY': return actor.philosophyTokens < 3 ? 4 : 2;
    case 'LEGISLATION': return actor.handCards.length < 3 ? 9 : 5;
    case 'CULTURE': return 3 + actor.cultureTrack;
    case 'TRADE': return 5 + actor.economyTrack;
    case 'MILITARY': return 5 + actor.militaryTrack + actor.troopTrack * 0.15;
    case 'POLITICS': return 8 + actor.handCards.reduce((best, card) => Math.max(best, cardValue(card)), 0) * 0.25;
    case 'DEVELOPMENT': return 10 + actor.developmentLevel * 3;
  }
}

function cardValue(card: PoliticsCard): number {
  const marquee: Record<string, number> = {
    'central-government': 34,
    diversification: 32,
    'gold-reserve': 30,
    'hall-of-statues': 28,
    'public-market': 26,
    taxation: 24,
    'corinthian-columns': 22,
    'constructing-the-mint': 22,
    reformists: 22,
    gradualism: 20,
    'old-guard': 20,
    'greek-fire': 18,
    council: 18,
    'scholarly-welcome': 18,
  };
  return (marquee[card.id] ?? 10)
    + (card.type === 'END_GAME' ? 9 : card.type === 'ONGOING' ? 7 : 4)
    - card.cost * 0.4
    + card.knowledgeRequirement.green + card.knowledgeRequirement.blue + card.knowledgeRequirement.red;
}

function tokenValue(token: KnowledgeToken): number {
  return (token.tokenType === 'MAJOR' ? 9 : 4)
    + (token.bonusVP ?? 0)
    + (token.bonusCoins ?? 0) * 0.35
    + (token.isPersepolis ? 12 : 0)
    - (token.skullValue ?? 0) * 0.6;
}

function canExploreToken(actor: PlayerState, token: KnowledgeToken, troopAfterGain: number): boolean {
  const requirement = token.militaryRequirement ?? 0;
  const skull = Math.max(0, (token.skullValue ?? 0) - (hasCard(actor, 'helepole') || hasDevUnlocked(actor, 'sparta-dev-1') ? 1 : 0));
  return troopAfterGain >= requirement && troopAfterGain >= skull;
}

function knowledgeShortfall(player: PlayerState, requirement: KnowledgeRequirement): number {
  const counts = knowledgeCounts(player);
  return Math.max(0, requirement.green - counts.GREEN)
    + Math.max(0, requirement.blue - counts.BLUE)
    + Math.max(0, requirement.red - counts.RED);
}

function knowledgeCounts(player: PlayerState): Record<KnowledgeColor, number> {
  return {
    GREEN: player.knowledgeTokens.filter(t => t.color === 'GREEN').length,
    BLUE: player.knowledgeTokens.filter(t => t.color === 'BLUE').length,
    RED: player.knowledgeTokens.filter(t => t.color === 'RED').length,
  };
}

function rankedKnowledgeColors(player: PlayerState): KnowledgeColor[] {
  const counts = knowledgeCounts(player);
  return (['GREEN', 'BLUE', 'RED'] as KnowledgeColor[])
    .sort((a, b) => knowledgeColorNeed(player, b) - knowledgeColorNeed(player, a) || counts[a] - counts[b]);
}

function knowledgeColorNeed(player: PlayerState, color: KnowledgeColor): number {
  const field = color.toLowerCase() as 'green' | 'blue' | 'red';
  return player.handCards.reduce((sum, card) => sum + Math.max(0, card.knowledgeRequirement[field] - knowledgeCounts(player)[color]), 0);
}

function progressCost(player: PlayerState, track: ProgressTrackType): number {
  const current = player[trackField(track)];
  let cost = PROGRESS_COSTS[track][current] ?? 99;
  if (track === 'ECONOMY' && hasCard(player, 'constructing-the-mint')) cost = 0;
  if (cost > 0 && hasCard(player, 'gradualism')) cost = Math.max(0, cost - 1);
  if (cost > 0 && hasDevUnlocked(player, 'corinth-dev-3')) cost = Math.max(0, cost - 1);
  return cost;
}

function virtualAdvanceProgress(player: PlayerState, track: ProgressTrackType): PlayerState | null {
  if (player[trackField(track)] >= 7) return null;
  const cost = progressCost(player, track);
  if (player.coins < cost) return null;
  return {
    ...player,
    coins: player.coins - cost,
    [trackField(track)]: player[trackField(track)] + 1,
  };
}

function progressValue(player: PlayerState, track: ProgressTrackType): number {
  const next = player[trackField(track)] + 1;
  const milestone =
    track === 'ECONOMY' && (next === 4 || next === 7) ? (next === 4 ? 5 : 10) :
    track === 'CULTURE' && [3, 5, 6, 7].includes(next) ? 4 :
    track === 'MILITARY' && [2, 4, 6, 7].includes(next) ? 4 :
    0;
  return 4 + milestone - progressCost(player, track) * 0.5;
}

function hasCard(player: PlayerState, cardId: string): boolean {
  return player.playedCards.some(card => card.id === cardId);
}

function trackField(track: ProgressTrackType): 'economyTrack' | 'cultureTrack' | 'militaryTrack' {
  if (track === 'ECONOMY') return 'economyTrack';
  if (track === 'CULTURE') return 'cultureTrack';
  return 'militaryTrack';
}

function combinations<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, chosen: T[]) => {
    if (chosen.length === size) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i < items.length; i++) {
      chosen.push(items[i]);
      walk(i + 1, chosen);
      chosen.pop();
    }
  };
  walk(0, []);
  return out;
}

function tokenLabel(token: KnowledgeToken): string {
  const special = token.isPersepolis ? ' Persepolis' : '';
  return `${formatColor(token.color)} ${token.tokenType.toLowerCase()}${special}`;
}

function formatColor(color: KnowledgeColor): string {
  return color.charAt(0) + color.slice(1).toLowerCase();
}

function formatTrack(track: ProgressTrackType): string {
  return track.charAt(0) + track.slice(1).toLowerCase();
}

function joinNatural(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`;
}

function errorResult(requestId: string, playerId: string, start: number, message: string): LiveSolverResult {
  return {
    requestId,
    playerId,
    generatedAt: Date.now(),
    status: 'ERROR',
    message,
    currentMove: null,
    rounds: [],
    projections: [],
    projectedMargin: null,
    searchedNodes: 0,
    completedLines: 0,
    computeMs: Date.now() - start,
    horizon: 'PARTIAL',
  };
}

function unavailableResult(requestId: string, playerId: string, start: number, message: string): LiveSolverResult {
  return {
    ...errorResult(requestId, playerId, start, message),
    status: 'UNAVAILABLE',
  };
}
