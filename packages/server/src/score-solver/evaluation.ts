import type { ActionChoices, ActionType, ClientMessage, GameState, PlayerState } from '@khora/shared';
import { calculateFinalScores } from '../scoring-engine';
import { ProgressPhaseManager } from '../phases/progress-phase';
import { ALL_POLITICS_CARDS, EXPANSION_POLITICS_CARDS } from '../game-data';
import { actionChoices } from './choices';
import { applyOngoingDevEffects } from '../city-dev-handlers';
import { applyOngoingEffects } from '../card-handlers';
import { PhilosophyResolver } from '../actions/philosophy-resolver';
import { LegislationResolver } from '../actions/legislation-resolver';
import { CultureResolver } from '../actions/culture-resolver';
import { TradeResolver } from '../actions/trade-resolver';
import { MilitaryResolver } from '../actions/military-resolver';
import { PoliticsResolver } from '../actions/politics-resolver';
import { DevelopmentResolver } from '../actions/development-resolver';

const progress = new ProgressPhaseManager();
const cards = new Map([...ALL_POLITICS_CARDS, ...EXPANSION_POLITICS_CARDS].map(c => [c.id, c]));
const resolvers = { PHILOSOPHY: new PhilosophyResolver(), LEGISLATION: new LegislationResolver(),
  CULTURE: new CultureResolver(), TRADE: new TradeResolver(), MILITARY: new MilitaryResolver(),
  POLITICS: new PoliticsResolver(), DEVELOPMENT: new DevelopmentResolver() };
const actionValues = new WeakMap<GameState, Map<string, number>>();
const finalScores = new WeakMap<GameState, Map<string, number>>();
const potentials = new WeakMap<GameState, Map<PlayerState, number[]>>();

function choiceValue(state: GameState, player: PlayerState, action: ActionType, choices: ActionChoices, strategy = 0): number {
  const result = resolvers[action].resolve(state, player.playerId, choices);
  if (!result.ok) return -Infinity;
  const next = applyOngoingDevEffects(applyOngoingEffects(result.value, player.playerId,
    { type: 'ON_ACTION', actionType: action }), player.playerId, action);
  return potential(next, next.players.find(p => p.playerId === player.playerId)!, strategy) - potential(state, player, strategy);
}

/** Move ordering only. Search statistics and displayed scores use actual final scoring. */
export function potential(state: GameState, player: PlayerState, strategy = 0): number {
  let players = potentials.get(state);
  if (!players) { players = new Map(); potentials.set(state, players); }
  let values = players.get(player);
  if (!values) { values = []; players.set(player, values); }
  if (values[strategy] !== undefined) return values[strategy];
  const remaining = Math.max(0, 9 - state.roundNumber);
  let scores = finalScores.get(state);
  if (!scores) {
    scores = new Map(calculateFinalScores(state).rankings.map(p => [p.playerId, p.totalPoints]));
    finalScores.set(state, scores);
  }
  const final = scores.get(player.playerId) ?? 0;
  const knowledge = ['GREEN', 'BLUE', 'RED'].reduce((value, color) => {
    const count = player.knowledgeTokens.filter(t => t.color === color).length;
    return value + Number(count > 0) * 0.4 + Number(count > 1) * 0.2;
  }, 0);
  // Value the steps toward the extra die, not just the completed unlock.
  const culture = [0, 0, 1, 2.5, 5, 5.7, 6.4, 7.1][player.cultureTrack];
  const emphasis = strategy === 1 ? culture * remaining + Math.min(player.coins, 8) * remaining * 0.1
    : strategy === 2 ? (player.militaryTrack * 0.6 + player.troopTrack * 0.12) * remaining
    : strategy === 3 ? (player.developmentLevel * 1.2 + knowledge) * remaining : 0;
  const value = final + emphasis + Math.min(player.coins, 25) * (0.1 + remaining * 0.1)
    + Math.min(player.philosophyTokens, 8) * (0.3 + remaining * 0.18)
    + Math.min(player.citizenTrack, 9) * 0.18 + player.troopTrack * (0.1 + remaining * 0.08)
    + knowledge * remaining
    + culture * remaining + player.economyTrack * remaining * 0.65
    + player.militaryTrack * remaining * 0.45 + player.taxTrack * remaining * 0.6
    + player.gloryTrack * remaining * 0.35
    + player.developmentLevel * remaining * 0.8
    + (player.cityId === 'athens' && player.developmentLevel >= 2 ? remaining * 1.5 : 0)
    + player.playedCards.filter(c => c.type === 'ONGOING').length * remaining * 0.55
    + player.handCards.length * remaining * 0.15;
  values[strategy] = value;
  return value;
}

function actionPriority(state: GameState, player: PlayerState, action: ActionType, strategy = 0): number {
  let cached = actionValues.get(state);
  if (!cached) { cached = new Map(); actionValues.set(state, cached); }
  const key = `${player.playerId}:${action}:${strategy}`;
  if (cached.has(key)) return cached.get(key)!;
  let best = -5;
  // Move ordering uses the real action effects, including card/city bonuses.
  // A flat priority otherwise keeps buying resources even on the final turn.
  for (const choices of actionChoices(state, player, action)) {
    best = Math.max(best, choiceValue(state, player, action, choices, strategy));
  }
  cached.set(key, best);
  return best;
}

export function priority(state: GameState, player: PlayerState, message: ClientMessage, strategy = 0): number {
  switch (message.type) {
    case 'ASSIGN_DICE': return message.assignments.reduce((sum, a) => sum + actionPriority(state, player, a.actionType, strategy)
      - Math.max(0, ['PHILOSOPHY', 'LEGISLATION', 'CULTURE', 'TRADE', 'MILITARY', 'POLITICS', 'DEVELOPMENT'].indexOf(a.actionType) - a.dieValue) * 0.25, 0) - (message.philosophyTokensToSpend ?? 0) * 1.5;
    case 'PROGRESS_TRACK': {
      const applied = progress.applySubmissionToPlayer(player, message);
      return applied.ok ? potential({ ...state, players: state.players.map(p => p.playerId === player.playerId ? applied.value : p) }, applied.value, strategy) - potential(state, player, strategy) : -Infinity;
    }
    case 'DRAFT_CARD': case 'PICK_BAN_CARD': {
      const card = cards.get(message.cardId);
      if (!card) return 0;
      return (card.type === 'ONGOING' ? 5 : 2) - card.cost * 0.2 - (card.knowledgeRequirement.green + card.knowledgeRequirement.blue + card.knowledgeRequirement.red) * 0.3;
    }
    case 'RESOLVE_ACTION': {
      return choiceValue(state, player, message.actionType, message.choices, strategy);
    }
    case 'SKIP_PHASE': return -10;
    default: return 0;
  }
}
