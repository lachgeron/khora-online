import type {
  ActionType,
  EventCard,
  GameEffect,
  GamePhase,
  PoliticsCard,
  ProgressTrackType,
  SolverFullPlayerState,
  SolverFullState,
} from '@khora/shared';
import type { ActionChoice, FrozenOpponent, SolverState } from './types';
import { applyAction } from './transitions';
import { cloneState, hasMaskBit, removeMaskBit } from './card-data';
import { progressCost } from './progress-enum';
import { advanceProgressTrack, capTaxGloryTrack, capTroops } from './tracks';

interface EventContext {
  initialRound: number;
  currentPhase: GamePhase;
  fullState: SolverFullState | null;
  cardIds: string[];
  allCards: PoliticsCard[];
  opponents: FrozenOpponent[];
  round?: number;
}

export interface EventResult {
  state: SolverState;
  description: string | null;
}

const PHASES_AFTER_EVENT = new Set<GamePhase>(['GLORY', 'ACHIEVEMENT', 'FINAL_SCORING', 'GAME_OVER']);

export function applyEventPhase(s: SolverState, ctx: EventContext): EventResult[] {
  const event = eventForRound(s.round, ctx);
  if (!event || event.triggerDuringDice) return [{ state: s, description: null }];
  if (s.round === ctx.initialRound && PHASES_AFTER_EVENT.has(ctx.currentPhase)) {
    return [{ state: s, description: null }];
  }

  const base = cloneState(s);
  const notes: string[] = [];
  if (event.immediateEffect) {
    applyGameEffect(base, event.immediateEffect);
    notes.push(event.name);
  }

  const roundCtx = { ...ctx, round: s.round };
  const result = applyEventById(base, event, roundCtx, notes);
  return result.map(r => ({
    state: r.state,
    description: r.descriptionParts.length > 0 ? `Event: ${r.descriptionParts.join('; ')}` : null,
  }));
}

function eventForRound(round: number, ctx: EventContext): EventCard | null {
  if (!ctx.fullState) return null;
  if (round === ctx.initialRound) return ctx.fullState.currentEvent;
  const deckIndex = round - ctx.initialRound - 1;
  return ctx.fullState.eventDeck[deckIndex] ?? null;
}

function applyEventById(
  s: SolverState,
  event: EventCard,
  ctx: EventContext,
  descriptionParts: string[],
): Array<{ state: SolverState; descriptionParts: string[] }> {
  switch (event.id) {
    case 'origin-of-academy':
      return [applyTroopComparisonEvent(s, ctx, descriptionParts, {
        win: st => { st.philosophyTokens += 1; },
        lose: st => { st.philosophyTokens = 0; },
        winText: 'forced highest troops (+1 scroll)',
        loseText: 'opponents can force lowest troops (lose all scrolls)',
      })];
    case 'conscripting-troops':
      return [applyTroopComparisonEvent(s, ctx, descriptionParts, {
        win: st => { st.citizenTrack = Math.min(15, st.citizenTrack + 3); },
        lose: st => { st.citizenTrack = Math.max(0, st.citizenTrack - 3); },
        winText: 'forced highest troops (+3 citizens)',
        loseText: 'opponents can force lowest troops (-3 citizens)',
      })];
    case 'eleusinian-mysteries':
      return [applyTroopComparisonEvent(s, ctx, descriptionParts, {
        win: st => { st.victoryPoints += 4; },
        lose: st => { st.victoryPoints = Math.max(0, st.victoryPoints - 4); },
        winText: 'forced highest troops (+4 VP)',
        loseText: 'opponents can force lowest troops (-4 VP)',
      })];
    case 'savior-of-greece':
      return [applyTroopComparisonEvent(s, ctx, descriptionParts, {
        win: st => { st.coins += 2; },
        lose: st => { st.coins = Math.max(0, st.coins - 2); },
        winText: 'forced highest troops (+2 coins)',
        loseText: 'opponents can force lowest troops (-2 coins)',
      })];
    case 'thirty-tyrants':
      return [applyTroopComparisonEvent(s, ctx, descriptionParts, {
        win: st => { st.handSlots += 2; },
        lose: st => discardHandSlots(st, ctx.allCards, 2),
        winText: 'forced highest troops (draw 2 cards)',
        loseText: 'opponents can force lowest troops (discard 2 cards)',
      })];
    case 'military-victory':
      return applyMilitaryVictory(s, ctx, descriptionParts);
    case 'prosperity':
      return applyProsperity(s, ctx, descriptionParts);
    case 'rise-of-persia':
      return applyRiseOfPersia(s, ctx, descriptionParts);
    case 'oracle-of-delphi':
      return [applyOracle(s, descriptionParts)];
    default:
      return [{ state: s, descriptionParts }];
  }
}

function applyTroopComparisonEvent(
  s: SolverState,
  ctx: EventContext,
  descriptionParts: string[],
  spec: {
    win: (s: SolverState) => void;
    lose: (s: SolverState) => void;
    winText: string;
    loseText: string;
  },
): { state: SolverState; descriptionParts: string[] } {
  const state = cloneState(s);
  const maxOpponent = maxOpponentTroopsThisRound(ctx);
  const minOpponentEscape = minOpponentMaxTroopsThisRound(ctx);
  const notes = [...descriptionParts];

  if (state.troopTrack > maxOpponent) {
    spec.win(state);
    notes.push(spec.winText);
  } else if (state.troopTrack <= minOpponentEscape) {
    spec.lose(state);
    notes.push(spec.loseText);
  } else {
    notes.push('no troop-comparison reward assumed');
  }
  return { state, descriptionParts: notes };
}

function applyMilitaryVictory(
  s: SolverState,
  ctx: EventContext,
  descriptionParts: string[],
): Array<{ state: SolverState; descriptionParts: string[] }> {
  if (s.troopTrack <= maxOpponentTroopsThisRound(ctx)) {
    return [{ state: s, descriptionParts: [...descriptionParts, 'Military Victory lost to opponent ceiling'] }];
  }
  return discountedProgressBranches(s, ctx, ['ECONOMY', 'CULTURE', 'MILITARY'], descriptionParts, 'Military Victory');
}

function applyRiseOfPersia(
  s: SolverState,
  ctx: EventContext,
  descriptionParts: string[],
): Array<{ state: SolverState; descriptionParts: string[] }> {
  const branches = discountedProgressBranches(s, ctx, ['MILITARY'], descriptionParts, 'Rise of Persia');
  return branches.length > 0 ? branches : [{ state: s, descriptionParts }];
}

function discountedProgressBranches(
  s: SolverState,
  ctx: EventContext,
  tracks: ProgressTrackType[],
  descriptionParts: string[],
  label: string,
): Array<{ state: SolverState; descriptionParts: string[] }> {
  const branches: Array<{ state: SolverState; descriptionParts: string[] }> = [
    { state: s, descriptionParts: [...descriptionParts, `${label}: skip discounted progress`] },
  ];
  for (const track of tracks) {
    const field = track === 'ECONOMY' ? 'economyTrack' : track === 'CULTURE' ? 'cultureTrack' : 'militaryTrack';
    const cost = Math.max(0, progressCost(track, s[field], id => hasPlayed(s, id, ctx.cardIds), id => devUnlocked(s, id)) - 2);
    if (!Number.isFinite(cost) || s.coins < cost) continue;
    const next = cloneState(s);
    next.coins -= cost;
    advanceProgressTrack(next, track, 1);
    branches.push({ state: next, descriptionParts: [...descriptionParts, `${label}: +1 ${track} for ${cost} coins`] });
  }
  return branches;
}

function applyProsperity(
  s: SolverState,
  ctx: EventContext,
  descriptionParts: string[],
): Array<{ state: SolverState; descriptionParts: string[] }> {
  if (s.troopTrack <= maxOpponentTroopsThisRound(ctx)) {
    return [{ state: s, descriptionParts: [...descriptionParts, 'Prosperity lost to opponent ceiling'] }];
  }
  const branches: Array<{ state: SolverState; descriptionParts: string[]; score: number }> = [
    { state: s, descriptionParts: [...descriptionParts, 'Prosperity: skip politics action'], score: s.victoryPoints + s.coins * 0.4 },
  ];
  for (let i = 0; i < ctx.allCards.length; i++) {
    const card = ctx.allCards[i];
    if (!card || !canConsiderEventPolitics(s, i) || !canPlayCard(s, card)) continue;
    const pairs = philosophyPairsNeeded(s, card);
    const choices: ActionChoice[] = card.id === 'scholarly-welcome'
      ? ['GREEN', 'BLUE', 'RED'].map(color => ({ type: 'POLITICS', cardIndex: i, philosophyPairs: pairs, scholarlyWelcomeColor: color }) as ActionChoice)
      : [{ type: 'POLITICS', cardIndex: i, philosophyPairs: pairs }];
    for (const choice of choices) {
      const next = cloneState(s);
      applyAction(next, choice, ctx.cardIds, ctx.allCards, ctx.opponents, id => hasPlayed(next, id, ctx.cardIds));
      const name = card.name ?? card.id;
      branches.push({
        state: next,
        descriptionParts: [...descriptionParts, `Prosperity: play "${name}"`],
        score: next.victoryPoints + next.coins * 0.4 + next.handSlots * 0.8,
      });
    }
  }
  branches.sort((a, b) => b.score - a.score);
  return branches.slice(0, 12).map(({ state, descriptionParts }) => ({ state, descriptionParts }));
}

function applyOracle(s: SolverState, descriptionParts: string[]): { state: SolverState; descriptionParts: string[] } {
  const state = cloneState(s);
  const removed = removeLeastUsefulKnowledge(state);
  if (removed) {
    state.philosophyTokens += 2;
    return { state, descriptionParts: [...descriptionParts, 'Oracle of Delphi: lose 1 token, gain 2 scrolls'] };
  }
  return { state, descriptionParts: [...descriptionParts, 'Oracle of Delphi: no token to lose'] };
}

function applyGameEffect(s: SolverState, effect: GameEffect): void {
  switch (effect.type) {
    case 'GAIN_COINS': s.coins += effect.amount; return;
    case 'LOSE_COINS': s.coins = Math.max(0, s.coins - effect.amount); return;
    case 'GAIN_CITIZENS': s.citizenTrack = Math.min(15, s.citizenTrack + effect.amount); return;
    case 'LOSE_CITIZENS': s.citizenTrack = Math.max(0, s.citizenTrack - effect.amount); return;
    case 'GAIN_PHILOSOPHY_TOKENS': s.philosophyTokens += effect.amount; return;
    case 'GAIN_VP': s.victoryPoints += effect.amount; return;
    case 'ADVANCE_TRACK': {
      if (effect.track === 'TROOP') {
        s.troopTrack = Math.max(0, s.troopTrack + effect.amount);
        capTroops(s);
      } else if (effect.track === 'CITIZEN') {
        s.citizenTrack = Math.max(0, Math.min(15, s.citizenTrack + effect.amount));
      } else if (effect.track === 'TAX') {
        s.taxTrack = capTaxGloryTrack(s.taxTrack + effect.amount);
      } else if (effect.track === 'GLORY') {
        s.gloryTrack = capTaxGloryTrack(s.gloryTrack + effect.amount);
      } else {
        advanceProgressTrack(s, effect.track, effect.amount);
      }
      return;
    }
    case 'COMPOSITE':
      for (const child of effect.effects) applyGameEffect(s, child);
      return;
  }
}

function maxOpponentTroopsThisRound(ctx: EventContext): number {
  const values = ctx.fullState?.players
    .filter(p => p.isConnected)
    .filter(p => !isUs(p, ctx))
    .map(p => opponentTroopCeiling(p, ctx)) ?? [];
  return values.length > 0 ? Math.max(...values) : -Infinity;
}

function minOpponentMaxTroopsThisRound(ctx: EventContext): number {
  const values = ctx.fullState?.players
    .filter(p => p.isConnected)
    .filter(p => !isUs(p, ctx))
    .map(p => opponentTroopCeiling(p, ctx)) ?? [];
  return values.length > 0 ? Math.min(...values) : Infinity;
}

function isUs(player: SolverFullPlayerState, ctx: EventContext): boolean {
  return !ctx.opponents.some(o => o.playerId === player.playerId);
}

function opponentTroopCeiling(player: SolverFullPlayerState, ctx: EventContext): number {
  const gains = unresolvedOpponentActions(player, ctx)
    .map(action => opponentTroopGainForAction(player, action));
  const topGains = gains.length > 0 ? gains : possibleOpponentTroopGains(player, ctx);
  return Math.min(15, player.troopTrack + topGains.reduce((sum, gain) => sum + Math.max(0, gain), 0));
}

function unresolvedOpponentActions(player: SolverFullPlayerState, ctx: EventContext): ActionType[] {
  if (ctx.round !== ctx.initialRound || ctx.currentPhase !== 'ACTIONS') return [];
  return player.actionSlots
    .filter((slot): slot is NonNullable<typeof slot> => slot !== null && !slot.resolved)
    .map(slot => slot.actionType);
}

function possibleOpponentTroopGains(player: SolverFullPlayerState, ctx: EventContext): number[] {
  if (ctx.round === ctx.initialRound && ['PROGRESS', 'GLORY', 'ACHIEVEMENT'].includes(ctx.currentPhase)) {
    return [];
  }
  const maxSlots = player.cultureTrack >= 4 ? 3 : 2;
  const gains: number[] = ['PHILOSOPHY', 'LEGISLATION', 'CULTURE', 'TRADE', 'MILITARY', 'POLITICS', 'DEVELOPMENT']
    .map(action => opponentTroopGainForAction(player, action as ActionType));
  gains.sort((a, b) => b - a);
  return gains.slice(0, maxSlots);
}

function opponentTroopGainForAction(player: SolverFullPlayerState, action: ActionType): number {
  switch (action) {
    case 'MILITARY': return player.militaryTrack;
    case 'CULTURE':
      return (opponentHasCard(player, 'persians') ? 2 : 0) +
        (player.cityId === 'olympia' && player.developmentLevel >= 2 ? 1 : 0);
    case 'TRADE':
      return (opponentHasCard(player, 'foreign-supplies') ? 2 : 0) +
        (opponentHasCard(player, 'diolkos') ? 1 : 0);
    case 'POLITICS':
      return opponentBestPoliticsTroopGain(player);
    case 'DEVELOPMENT':
      return opponentDevelopmentTroopGain(player);
    default:
      return 0;
  }
}

function opponentHasCard(player: SolverFullPlayerState, id: string): boolean {
  return player.playedCards.some(c => c.id === id);
}

function opponentBestPoliticsTroopGain(player: SolverFullPlayerState): number {
  let best = 0;
  for (const card of player.handCards) {
    if (player.coins < card.cost || !opponentMeetsKnowledge(player, card)) continue;
    let gain = player.cityId === 'athens' && player.developmentLevel >= 3 ? 2 : 0;
    if (card.id === 'greek-fire') gain += 4;
    if (card.id === 'mercenary-recruitment') gain += player.economyTrack;
    best = Math.max(best, gain);
  }
  return best;
}

function opponentDevelopmentTroopGain(player: SolverFullPlayerState): number {
  const nextLevel = player.developmentLevel + 1;
  if (player.cityId === 'argos' && nextLevel === 2) return 2;
  if (player.cityId === 'sparta' && nextLevel === 3) return Math.max(0, player.militaryTrack * 2);
  return 0;
}

function opponentMeetsKnowledge(player: SolverFullPlayerState, card: PoliticsCard): boolean {
  const counts = { GREEN: 0, BLUE: 0, RED: 0 };
  for (const token of player.knowledgeTokens) counts[token.color] += 1;
  const req = card.knowledgeRequirement;
  const missing = Math.max(0, req.green - counts.GREEN) +
    Math.max(0, req.blue - counts.BLUE) +
    Math.max(0, req.red - counts.RED);
  return player.philosophyTokens >= missing * 2;
}

function canConsiderEventPolitics(s: SolverState, cardIndex: number): boolean {
  if (hasMaskBit(s.playedMask, cardIndex)) return false;
  if (hasMaskBit(s.handMask, cardIndex)) return true;
  return s.godMode && s.handSlots > 0;
}

function canPlayCard(s: SolverState, card: PoliticsCard): boolean {
  if (s.coins < card.cost) return false;
  return philosophyPairsNeeded(s, card) >= 0;
}

function philosophyPairsNeeded(s: SolverState, card: PoliticsCard): number {
  for (let pairs = 0; pairs <= 3; pairs++) {
    if (s.philosophyTokens < pairs * 2) break;
    if (meetsReqSolver(s, card.knowledgeRequirement, pairs)) return pairs;
  }
  return -1;
}

function meetsReqSolver(
  s: SolverState,
  req: { green: number; blue: number; red: number },
  philosophyPairs: number,
): boolean {
  const g = s.knowledge.greenMinor + s.knowledge.greenMajor;
  const b = s.knowledge.blueMinor + s.knowledge.blueMajor;
  const r = s.knowledge.redMinor + s.knowledge.redMajor;
  const totalHave = Math.min(g, req.green) + Math.min(b, req.blue) + Math.min(r, req.red);
  const totalRequired = req.green + req.blue + req.red;
  const shortfall = totalRequired - totalHave;
  return shortfall <= philosophyPairs;
}

function hasPlayed(s: SolverState, id: string, cardIds: string[]): boolean {
  const idx = cardIds.indexOf(id);
  return idx >= 0 && hasMaskBit(s.playedMask, idx);
}

function devUnlocked(s: SolverState, id: string): boolean {
  const m = /^([a-z]+)-dev-(\d)$/.exec(id);
  if (!m) return false;
  return s.cityId === m[1] && s.developmentLevel >= parseInt(m[2], 10);
}

function discardHandSlots(s: SolverState, allCards: PoliticsCard[], count: number): void {
  const toDiscard = Math.min(count, s.handSlots);
  for (let n = 0; n < toDiscard; n++) {
    let removeIndex = -1;
    let removeScore = Infinity;
    for (let i = 0; i < allCards.length; i++) {
      if (!hasMaskBit(s.handMask, i)) continue;
      const card = allCards[i];
      const score = (card?.type === 'END_GAME' ? 5 : 0) + (card?.cost ?? 0);
      if (score < removeScore) {
        removeScore = score;
        removeIndex = i;
      }
    }
    if (removeIndex >= 0) s.handMask = removeMaskBit(s.handMask, removeIndex);
    s.handSlots = Math.max(0, s.handSlots - 1);
  }
}

function removeLeastUsefulKnowledge(s: SolverState): boolean {
  const order: Array<keyof SolverState['knowledge']> = [
    'greenMinor', 'blueMinor', 'redMinor',
    'greenMajor', 'blueMajor', 'redMajor',
  ];
  for (const key of order) {
    if (s.knowledge[key] > 0) {
      s.knowledge[key] -= 1;
      return true;
    }
  }
  return false;
}
