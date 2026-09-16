import type { ActionChoices, ActionType, ClientMessage, GameState, KnowledgeColor, KnowledgeRequirement, PlayerState, ProgressTrackType, ScoreSolverMove } from '@khora/shared';
import { ACTION_NUMBERS } from '@khora/shared';
import { getActivatableDevs, hasDevUnlocked } from '../city-dev-handlers';
import { ALL_CITIES, ALL_POLITICS_CARDS, EXPANSION_POLITICS_CARDS } from '../game-data';
import { ProgressPhaseManager } from '../phases/progress-phase';
import { MilitaryResolver } from '../actions/military-resolver';
import { applyOngoingEffects } from '../card-handlers';

const actions = Object.keys(ACTION_NUMBERS) as ActionType[];
const tracks: ProgressTrackType[] = ['ECONOMY', 'CULTURE', 'MILITARY'];
const colors: KnowledgeColor[] = ['GREEN', 'BLUE', 'RED'];
const progress = new ProgressPhaseManager();
const military = new MilitaryResolver();

function shortfall(player: PlayerState, requirement: KnowledgeRequirement): number {
  return colors.reduce((sum, color) => sum + Math.max(0,
    requirement[color.toLowerCase() as 'green' | 'blue' | 'red'] - player.knowledgeTokens.filter(t => t.color === color).length), 0);
}

export function* actionChoices(state: GameState, player: PlayerState, action: ActionType): Generator<ActionChoices> {
  switch (action) {
    case 'PHILOSOPHY': case 'CULTURE': yield {}; return;
    case 'TRADE':
      yield { buyMinorKnowledge: false };
      for (const color of colors) yield { buyMinorKnowledge: true, minorKnowledgeColor: color };
      return;
    case 'LEGISLATION': {
      const cards = state.politicsDeck.slice(0, player.playedCards.some(c => c.id === 'ecclesia') ? 3 : 2);
      if (!cards.length) yield {};
      for (const card of cards) yield { targetCardId: card.id };
      return;
    }
    case 'POLITICS':
      for (const card of player.handCards) {
        const pairs = shortfall(player, card.knowledgeRequirement);
        if (card.cost > player.coins || pairs * 2 > player.philosophyTokens) continue;
        const base = { targetCardId: card.id, philosophyPairsToUse: pairs };
        if (card.id === 'scholarly-welcome') {
          for (const color of colors) yield { ...base, scholarlyWelcomeColor: color };
        } else if (card.id === 'ostracism') {
          const returned = player.playedCards.filter(c => c.id !== 'ostracism');
          if (!returned.length) yield base;
          for (const target of returned) yield { ...base, ostracismReturnCardId: target.id };
        } else yield base;
      }
      return;
    case 'MILITARY': {
      yield {};
      const tokens = state.centralBoardTokens.filter(t => !t.explored);
      for (const first of tokens) {
        yield { explorationTokenId: first.id };
        if (hasDevUnlocked(player, 'thebes-dev-3')) {
          for (const second of tokens) if (first.id !== second.id) yield { explorationTokenId: first.id, secondExplorationTokenId: second.id };
        }
      }
      return;
    }
    case 'DEVELOPMENT': {
      const dev = ALL_CITIES.find(c => c.id === player.cityId)?.developments[player.developmentLevel];
      if (!dev) return;
      const base = { philosophyPairsToUse: shortfall(player, dev.knowledgeRequirement) };
      if (base.philosophyPairsToUse * 2 > player.philosophyTokens || dev.drachmaCost > player.coins) return;
      if (dev.id === 'miletus-dev-2') {
        for (const first of tracks) for (const second of tracks) yield { ...base, devTrackChoices: [first, second] };
      } else if (dev.id === 'argos-dev-2') {
        for (const reward of ['troops', 'coins', 'vp', 'citizens'] as const) yield { ...base, argosDevReward: reward };
      } else if (dev.id === 'sparta-dev-3') {
        const tokens = ['', ...state.centralBoardTokens.filter(t => !t.explored).map(t => t.id)];
        for (const first of tokens) for (const second of tokens) {
          if (first && first === second) continue;
          const firstResult = military.resolve(state, player.playerId, { explorationTokenId: first || undefined });
          if (!firstResult.ok) continue;
          const intermediate = applyOngoingEffects(firstResult.value, player.playerId, { type: 'ON_ACTION', actionType: 'MILITARY' });
          if (!military.resolve(intermediate, player.playerId, { explorationTokenId: second || undefined }).ok) continue;
          yield { ...base, spartaMilitaryTokenIds: [first, second] };
        }
      } else yield base;
    }
  }
}

function* diceAssignments(player: PlayerState): Generator<ClientMessage> {
  const dice = player.diceRoll ?? [];
  const maxSpend = Math.min(player.philosophyTokens, Math.ceil((15 - player.citizenTrack) / 3));
  function* assign(chosen: ActionType[]): Generator<ClientMessage> {
    if (chosen.length === dice.length) {
      const assignments = chosen.map((actionType, i) => ({ actionType, dieValue: dice[i], slotIndex: i as 0 | 1 | 2 }));
      const cost = assignments.reduce((sum, a) => sum + Math.max(0, ACTION_NUMBERS[a.actionType] - a.dieValue), 0);
      for (let spend = 0; spend <= maxSpend; spend++) {
        if (Math.min(15, player.citizenTrack + spend * 3) >= cost) yield { type: 'ASSIGN_DICE', assignments, philosophyTokensToSpend: spend };
      }
      return;
    }
    for (const action of actions) if (!chosen.includes(action)) yield* assign([...chosen, action]);
  }
  if (dice.length) yield* assign([]);
}

function* progressChoices(player: PlayerState): Generator<ClientMessage> {
  yield { type: 'SKIP_PHASE' };
  const bonus = Number(player.playedCards.some(c => c.id === 'reformists')) + Number(hasDevUnlocked(player, 'corinth-dev-3'));
  const max = Math.min(21 - player.economyTrack - player.cultureTrack - player.militaryTrack, 1 + bonus + player.philosophyTokens);
  // Track order has no effect on costs or resulting resources. Enumerate multisets,
  // including repeated advances, without factorial duplicates or wasted scrolls.
  function* combinations(sequence: ProgressTrackType[], start: number, length: number): Generator<ClientMessage> {
    if (sequence.length === length) {
      const free = Math.min(bonus, sequence.length - 1);
      const message: Extract<ClientMessage, { type: 'PROGRESS_TRACK' }> = {
        type: 'PROGRESS_TRACK', advancement: { track: sequence[0] },
        bonusTracks: sequence.slice(1, 1 + free).map(track => ({ track })),
        extraTracks: sequence.slice(1 + free).map(track => ({ track })),
      };
      if (progress.applySubmissionToPlayer(player, message).ok) yield message;
      return;
    }
    for (let i = start; i < tracks.length; i++) {
      const level = [player.economyTrack, player.cultureTrack, player.militaryTrack][i];
      if (sequence.filter(t => t === tracks[i]).length < 7 - level) yield* combinations([...sequence, tracks[i]], i, length);
    }
  }
  for (let count = 1; count <= max; count++) yield* combinations([], 0, count);
}

/** Candidate payloads are validated by the real game engine before use. */
export function* candidateMessages(state: GameState, playerId: string): Generator<ClientMessage> {
  const player = state.players.find(p => p.playerId === playerId);
  if (!player || player.hasFlagged || state.currentPhase === 'GAME_OVER') return;
  for (const devId of getActivatableDevs(player)) yield { type: 'ACTIVATE_DEV', devId };
  const decision = state.pendingDecisions.find(d => d.playerId === playerId && d.decisionType !== 'PHASE_DISPLAY');
  if (!decision) return;
  switch (decision.decisionType) {
    case 'SELECT_CITY':
      for (const cityId of state.draftState?.cityDraft?.offeredCities[playerId] ?? []) yield { type: 'SELECT_CITY', cityId };
      return;
    case 'DRAFT_CARD':
      for (const card of state.draftState?.politicsDraft?.packs[playerId] ?? []) yield { type: 'DRAFT_CARD', cardId: card.id };
      return;
    case 'PICK_BAN_CARD': {
      const draft = state.draftState?.pickBanDraft;
      if (!draft) return;
      const used = new Set([...Object.values(draft.bannedCards), ...Object.values(draft.pickedCards)].flat().map(c => c.id));
      for (const card of draft.allCards) if (!used.has(card.id)) yield { type: 'PICK_BAN_CARD', action: draft.phase, cardId: card.id };
      return;
    }
    case 'ROLL_DICE': yield { type: 'ROLL_DICE' }; return;
    case 'SPEND_PHILOSOPHY_TOKENS': case 'ASSIGN_DICE': yield* diceAssignments(player); return;
    case 'PROGRESS_TRACK': yield* progressChoices(player); return;
    case 'ACHIEVEMENT_TRACK_CHOICE':
      for (const trackChoice of ['TAX', 'GLORY'] as const) yield { type: 'CLAIM_ACHIEVEMENT', achievementId: (decision.options as { achievementId: string }).achievementId, trackChoice };
      return;
    case 'ORACLE_CHOOSE_TOKEN':
      for (const token of player.knowledgeTokens) yield { type: 'CHOOSE_TOKEN', tokenId: token.id };
      return;
    case 'MILITARY_VICTORY_PROGRESS': case 'RISE_OF_PERSIA_PROGRESS':
      for (const track of decision.decisionType === 'RISE_OF_PERSIA_PROGRESS' ? ['MILITARY'] as const : tracks) yield { type: 'EVENT_PROGRESS_TRACK', track };
      yield { type: 'SKIP_PHASE' }; return;
    case 'THIRTY_TYRANTS_DISCARD':
      if (player.handCards.length <= 2) yield { type: 'DISCARD_CARDS', cardIds: player.handCards.map(c => c.id) };
      else for (let i = 0; i < player.handCards.length; i++) for (let j = i + 1; j < player.handCards.length; j++) yield { type: 'DISCARD_CARDS', cardIds: [player.handCards[i].id, player.handCards[j].id] };
      return;
    case 'EXPANSION_CHOICE': {
      const choice = state.expansionChoices?.[0];
      if (!choice || choice.playerId !== playerId) return;
      switch (choice.kind) {
        case 'TOKEN':
          for (const token of player.knowledgeTokens.filter(t => t.tokenType === 'MINOR')) yield { type: 'RESOLVE_EXPANSION', value: token.id };
          break;
        case 'DRAW': for (const card of choice.cards ?? []) yield { type: 'RESOLVE_EXPANSION', value: card.id }; break;
        case 'REWARD':
          for (const value of ['coin', 'scroll']) yield { type: 'RESOLVE_EXPANSION', value };
          break;
        case 'POLITICS':
          for (const choices of actionChoices(state, player, 'POLITICS')) yield { type: 'RESOLVE_EXPANSION', choices };
          yield { type: 'RESOLVE_EXPANSION', value: 'skip' }; break;
        case 'COINS': case 'ENLIST': case 'GLORY': {
          const max = choice.kind === 'COINS' ? Math.min(3, player.coins) : choice.kind === 'ENLIST' ? Math.min(1, player.citizenTrack) : choice.amount ?? 0;
          for (let amount = 0; amount <= max; amount++) yield { type: 'RESOLVE_EXPANSION', amount };
        }
      }
      return;
    }
    case 'RESOLVE_ACTION': case 'CHOOSE_LEGISLATION_CARD': case 'CHOOSE_TRADE_BUY': case 'CHOOSE_EXPLORATION': case 'CHOOSE_POLITICS_CARD': case 'CHOOSE_DEVELOPMENT':
    case 'PROSPERITY_POLITICS': case 'CONQUEST_ACTION': {
      const nextAction = player.actionSlots.filter(s => s && !s.resolved).sort((a, b) => ACTION_NUMBERS[a!.actionType] - ACTION_NUMBERS[b!.actionType])[0]?.actionType;
      const chosen = decision.decisionType === 'CONQUEST_ACTION' ? actions.filter(a => a !== 'MILITARY')
        : decision.decisionType === 'PROSPERITY_POLITICS' ? ['POLITICS'] as const
        : nextAction ? [nextAction] : [];
      for (const actionType of chosen) for (const choices of actionChoices(state, player, actionType)) yield { type: 'RESOLVE_ACTION', actionType, choices };
      yield { type: 'SKIP_PHASE' };
      return;
    }
    case 'PHASE_DISPLAY': return;
    default: {
      const exhaustive: never = decision.decisionType;
      throw new Error(`Unsupported decision: ${exhaustive}`);
    }
  }
}

const cardNames = new Map([...ALL_POLITICS_CARDS, ...EXPANSION_POLITICS_CARDS].map(c => [c.id, c.name]));
const title = (text: string) => text.toLowerCase().replace(/[_-]/g, ' ').replace(/^./, c => c.toUpperCase());

export function describeMove(state: GameState, playerId: string, message: ClientMessage): ScoreSolverMove {
  const card = (id: string) => cardNames.get(id) ?? title(id);
  const token = (id: string) => {
    const found = [...state.centralBoardTokens, ...state.players.flatMap(p => p.knowledgeTokens)].find(t => t.id === id);
    if (!found) return title(id);
    const markers = [found.militaryRequirement && `${found.militaryRequirement} troops`,
      found.skullValue !== undefined && `${found.skullValue} skulls`, found.bonusVP && `+${found.bonusVP} VP`, found.bonusCoins && `+${found.bonusCoins} coins`].filter(Boolean);
    return `${found.isPersepolis ? 'Persepolis' : `${title(found.color)} ${found.tokenType.toLowerCase()}`}${markers.length ? ` (${markers.join(', ')})` : ''}`;
  };
  const details = (choices: ActionChoices) => [
    choices.targetCardId && card(choices.targetCardId),
    choices.explorationTokenId && `Explore ${token(choices.explorationTokenId)}`,
    choices.secondExplorationTokenId && `then ${token(choices.secondExplorationTokenId)}`,
    choices.buyMinorKnowledge && `Buy ${title(choices.minorKnowledgeColor ?? 'GREEN')} minor`,
    choices.philosophyPairsToUse && `Spend ${choices.philosophyPairsToUse * 2} scrolls for knowledge`,
    choices.devTrackChoices?.map(title).join(' + '),
    choices.argosDevReward && `Choose ${choices.argosDevReward}`,
    choices.scholarlyWelcomeColor && `Choose ${title(choices.scholarlyWelcomeColor)} minor`,
    choices.ostracismReturnCardId && `Return ${card(choices.ostracismReturnCardId)}`,
    choices.spartaMilitaryTokenIds?.map(id => id ? token(id) : 'No exploration').join(' → '),
  ].filter(Boolean).join('; ');
  let instruction: string;
  switch (message.type) {
    case 'SELECT_CITY': instruction = `Select ${title(message.cityId)}`; break;
    case 'DRAFT_CARD': instruction = `Draft ${card(message.cardId)}`; break;
    case 'PICK_BAN_CARD': instruction = `${title(message.action)} ${card(message.cardId)}`; break;
    case 'ROLL_DICE': instruction = 'Roll dice'; break;
    case 'ASSIGN_DICE': instruction = `${message.assignments.map(a => `${a.dieValue} → ${title(a.actionType)}`).join(', ')}${message.philosophyTokensToSpend ? `; spend ${message.philosophyTokensToSpend} scroll(s) for citizens` : ''}`; break;
    case 'RESOLVE_ACTION': instruction = `${title(message.actionType)}${details(message.choices) ? `: ${details(message.choices)}` : ''}`; break;
    case 'PROGRESS_TRACK': instruction = `Advance ${[message.advancement, ...message.bonusTracks ?? [], ...message.extraTracks ?? []].map(t => title(t.track)).join(' → ')}${message.extraTracks?.length ? `; spend ${message.extraTracks.length} scroll(s)` : ''}`; break;
    case 'CLAIM_ACHIEVEMENT': instruction = `Achievement: +1 ${title(message.trackChoice)}`; break;
    case 'EVENT_PROGRESS_TRACK': instruction = `Advance ${title(message.track)}`; break;
    case 'DISCARD_CARDS': instruction = `Discard ${message.cardIds.map(card).join(' and ')}`; break;
    case 'CHOOSE_TOKEN': instruction = `Give up ${token(message.tokenId)}`; break;
    case 'ACTIVATE_DEV': instruction = 'Thebes: exchange 1 Glory for 2 coins and 4 VP'; break;
    case 'RESOLVE_EXPANSION': {
      const choice = state.expansionChoices?.[0];
      const value = message.choices ? details(message.choices) : choice?.kind === 'TOKEN' ? token(message.value ?? '') : choice?.kind === 'DRAW' ? card(message.value ?? '') : message.value ?? String(message.amount ?? 0);
      instruction = `${card(choice?.cardId ?? 'Card choice')}: ${choice?.kind === 'COINS' ? 'Spend ' : choice?.kind === 'GLORY' ? 'Replace Glory: ' : ''}${value}`; break;
    }
    case 'SKIP_PHASE': instruction = state.currentPhase === 'ACTIONS' ? 'Skip / automatically resolve remaining actions' : 'Decline / skip'; break;
    default: instruction = title(message.type);
  }
  return { playerId, playerName: state.players.find(p => p.playerId === playerId)?.playerName ?? playerId,
    round: state.roundNumber, phase: state.currentPhase,
    decision: message.type === 'ACTIVATE_DEV' ? 'ACTIVATE_DEV' : state.pendingDecisions.find(d => d.playerId === playerId)?.decisionType ?? 'PHASE_DISPLAY', message, instruction };
}
