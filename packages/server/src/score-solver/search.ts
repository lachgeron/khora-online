import type { ActionType, ClientMessage, GameState, PlayerState, ScoreSolverMove, ScoreSolverResult } from '@khora/shared';
import { calculateFinalScores } from '../scoring-engine';
import { ProgressPhaseManager } from '../phases/progress-phase';
import { ALL_CITIES, ALL_POLITICS_CARDS, EXPANSION_POLITICS_CARDS } from '../game-data';
import { actionChoices, candidateMessages, describeMove } from './choices';
import { positionKey, settle, simulate, type SearchState } from './simulation';
import { getActivatableDevs } from '../city-dev-handlers';

const progress = new ProgressPhaseManager();
const cards = new Map([...ALL_POLITICS_CARDS, ...EXPANSION_POLITICS_CARDS].map(c => [c.id, c]));

/** Move ordering only. Search statistics and displayed scores use actual final scoring. */
function potential(state: GameState, player: PlayerState): number {
  const remaining = Math.max(0, 9 - state.roundNumber);
  const final = calculateFinalScores(state).rankings.find(p => p.playerId === player.playerId)?.totalPoints ?? 0;
  return final + Math.min(player.coins, 25) * (0.15 + remaining * 0.045)
    + Math.min(player.philosophyTokens, 8) * (0.3 + remaining * 0.09)
    + Math.min(player.citizenTrack, 9) * 0.1 + player.troopTrack * (0.1 + remaining * 0.02)
    + player.knowledgeTokens.length * remaining * 0.6
    + player.cultureTrack * remaining * 0.7 + player.economyTrack * remaining * 0.25
    + player.militaryTrack * remaining * 0.3 + player.taxTrack * remaining * 0.35
    + player.developmentLevel * remaining * 0.8
    + (player.cultureTrack >= 4 ? remaining * 3 : 0)
    + player.playedCards.filter(c => c.type === 'ONGOING').length * remaining * 0.55
    + player.handCards.length * remaining * 0.15;
}

function actionPriority(state: GameState, player: PlayerState, action: ActionType): number {
  const remaining = 10 - state.roundNumber;
  switch (action) {
    case 'PHILOSOPHY': return Math.max(0.2, 2.5 - player.philosophyTokens * 0.4);
    case 'LEGISLATION': return Math.max(0.2, 2.6 - player.handCards.length * 0.35) + (player.citizenTrack < 3 ? 1 : 0);
    case 'CULTURE': return player.cultureTrack + remaining * 0.1;
    case 'TRADE': return player.economyTrack * (player.coins < 8 ? 1.4 : 0.4);
    case 'MILITARY': return state.centralBoardTokens.some(t => !t.explored && (t.militaryRequirement ?? Infinity) <= player.troopTrack + player.militaryTrack) ? 5 : 1.5;
    case 'POLITICS': return !actionChoices(state, player, 'POLITICS').next().done ? 4 : -1;
    case 'DEVELOPMENT': {
      const dev = ALL_CITIES.find(c => c.id === player.cityId)?.developments[player.developmentLevel];
      return dev && !actionChoices(state, player, 'DEVELOPMENT').next().done ? 4 + remaining * 0.3 : -1;
    }
  }
}

function priority(state: GameState, player: PlayerState, message: ClientMessage): number {
  switch (message.type) {
    case 'ASSIGN_DICE': return message.assignments.reduce((sum, a) => sum + actionPriority(state, player, a.actionType)
      - Math.max(0, ['PHILOSOPHY', 'LEGISLATION', 'CULTURE', 'TRADE', 'MILITARY', 'POLITICS', 'DEVELOPMENT'].indexOf(a.actionType) - a.dieValue) * 0.12, 0) - (message.philosophyTokensToSpend ?? 0) * 0.3;
    case 'PROGRESS_TRACK': {
      const applied = progress.applySubmissionToPlayer(player, message);
      return applied.ok ? potential({ ...state, players: state.players.map(p => p.playerId === player.playerId ? applied.value : p) }, applied.value) - potential(state, player) : -Infinity;
    }
    case 'DRAFT_CARD': case 'PICK_BAN_CARD': {
      const card = cards.get(message.cardId);
      if (!card) return 0;
      return (card.type === 'ONGOING' ? 5 : 2) - card.cost * 0.2 - (card.knowledgeRequirement.green + card.knowledgeRequirement.blue + card.knowledgeRequirement.red) * 0.3;
    }
    case 'RESOLVE_ACTION': {
      const tokenValue = (id?: string) => {
        const token = state.centralBoardTokens.find(t => t.id === id);
        if (!token) return 0;
        if ((token.militaryRequirement ?? Infinity) > player.troopTrack + player.militaryTrack) return -100;
        return (token.bonusVP ?? 0) + (token.bonusCoins ?? 0) * 0.3
          + (token.isPersepolis ? player.gloryTrack * 3 + 6 : token.tokenType === 'MAJOR' ? player.gloryTrack + 3 : 1)
          + (player.knowledgeTokens.some(t => t.color === token.color) ? 0 : 2);
      };
      return actionPriority(state, player, message.actionType) + tokenValue(message.choices.explorationTokenId) + tokenValue(message.choices.secondExplorationTokenId);
    }
    case 'SKIP_PHASE': return -10;
    default: return 0;
  }
}

interface Edge { message: ClientMessage | null; state: SearchState; visits: number; totals: number[]; }
interface Node { state: SearchState; actor: string; messages: (ClientMessage | null)[] | null; cursor: number; edges: Edge[]; visits: number; }

export function preferredEdge(edges: Edge[], actorIndex: number): Edge | undefined {
  return edges.filter(e => e.visits > 0).sort((a, b) => b.totals[actorIndex] / b.visits - a.totals[actorIndex] / a.visits || b.visits - a.visits)[0] ?? edges[0];
}

export class ScoreSearch {
  private nodes = new Map<string, Node>();
  private root!: Node;
  private original!: GameState;
  private playerId = '';
  private requestId = '';
  private started = 0;
  private rollouts = 0;
  private evaluated = 0;
  private plan: ScoreSolverMove[] = [];
  private score: number | null = null;
  private planMessage = '';

  reset(state: GameState, playerId: string, requestId: string): void {
    // Reuse matching positions, including opponent moves, but bound memory.
    if (this.original?.gameId !== state.gameId || this.playerId !== playerId || this.nodes.size > 1500) this.nodes.clear();
    this.original = state;
    this.playerId = playerId;
    this.requestId = requestId;
    this.started = performance.now();
    this.rollouts = 0;
    this.evaluated = 0;
    this.plan = [];
    this.score = null;
    this.planMessage = '';
    this.root = this.node(settle(state, true));
  }

  private actor(state: SearchState): string {
    // For simultaneous choices, analyze the local player's still-unsubmitted choice first.
    return state.pendingDecisions.find(d => d.playerId === this.playerId && d.decisionType !== 'PHASE_DISPLAY')?.playerId
      ?? state.pendingDecisions.find(d => d.decisionType !== 'PHASE_DISPLAY')?.playerId
      ?? [...state.players].sort((a, b) => Number(b.playerId === this.playerId) - Number(a.playerId === this.playerId))
        .find(p => !p.hasFlagged && !state.analysisPassed?.includes(p.playerId) && getActivatableDevs(p).length)?.playerId ?? '';
  }

  private node(state: GameState): Node {
    const key = positionKey(state);
    let node = this.nodes.get(key);
    if (!node) {
      node = { state, actor: this.actor(state), messages: null, cursor: 0, edges: [], visits: 0 };
      if (this.nodes.size < 2000) this.nodes.set(key, node);
    }
    return node;
  }

  private *messages(node: Node): Generator<void> {
    if (node.messages) return;
    const player = node.state.players.find(p => p.playerId === node.actor);
    if (!player) { node.messages = []; return; }
    const ranked: { message: ClientMessage | null; rank: number }[] = [];
    for (const message of candidateMessages(node.state, node.actor)) {
      ranked.push({ message, rank: priority(node.state, player, message) });
      yield;
    }
    if (!node.state.pendingDecisions.some(d => d.decisionType !== 'PHASE_DISPLAY')) ranked.push({ message: null, rank: 0 });
    ranked.sort((a, b) => b.rank - a.rank);
    node.messages = ranked.map(r => r.message);
  }

  private *expand(node: Node, limit: number): Generator<void> {
    yield* this.messages(node);
    while (node.cursor < node.messages!.length && node.edges.length < limit) {
      const message = node.messages![node.cursor++];
      const next = message ? simulate(node.state, node.actor, message)
        : { ...node.state, analysisPassed: [...node.state.analysisPassed ?? [], node.actor] };
      this.evaluated++;
      if (next) node.edges.push({ message, state: settle(next, true), visits: 0, totals: node.state.players.map(() => 0) });
      yield;
    }
  }

  private *greedy(state: GameState, variation: number): Generator<void, { state: GameState; path: ScoreSolverMove[] }> {
    const path: ScoreSolverMove[] = [];
    for (let depth = 0; depth < 700 && state.currentPhase !== 'GAME_OVER'; depth++) {
      const node = this.node(state);
      yield* this.expand(node, 8);
      if (!node.edges.length) throw new Error(`No legal continuation for ${node.actor} in ${state.currentPhase}.`);
      const actorIndex = state.players.findIndex(p => p.playerId === node.actor);
      const learned = preferredEdge(node.edges.filter(e => e.visits > 0), actorIndex);
      const ordered = node.edges.map(edge => {
        const p = edge.state.players[actorIndex];
        let value = potential(edge.state, p);
        if (edge.message?.type === 'ASSIGN_DICE') value += priority(state, state.players[actorIndex], edge.message);
        if (edge.message?.type === 'PROGRESS_TRACK' && edge.state.progressSubmissions?.[node.actor]) {
          value += priority(state, state.players[actorIndex], edge.message);
        }
        if (edge.message?.type === 'DRAFT_CARD' || edge.message?.type === 'PICK_BAN_CARD') value += priority(state, state.players[actorIndex], edge.message);
        return { edge, value };
      }).sort((a, b) => b.value - a.value);
      const explore = variation > 0 && (depth + variation) % 13 === 0;
      const edge = explore ? ordered[Math.min(ordered.length - 1, variation % 3)].edge : learned ?? ordered[0].edge;
      if (edge.message) path.push(describeMove(state, node.actor, edge.message));
      state = edge.state;
      yield;
    }
    if (state.currentPhase !== 'GAME_OVER') throw new Error('Continuation exceeded the search safety limit.');
    return { state, path };
  }

  private *iteration(): Generator<void> {
    let node = this.root;
    const visited: { node: Node; edge: Edge }[] = [];
    for (let depth = 0; depth < 120 && node.state.currentPhase !== 'GAME_OVER'; depth++) {
      // Every legal candidate can enter as the position receives more search time.
      yield* this.expand(node, 8 + Math.floor(Math.sqrt(node.visits + 1) * 2));
      if (!node.edges.length) throw new Error(`No legal move for ${node.actor}.`);
      const index = node.state.players.findIndex(p => p.playerId === node.actor);
      const edge = node.edges.find(e => !e.visits) ?? [...node.edges].sort((a, b) => {
        const ucb = (e: Edge) => e.totals[index] / e.visits + 18 * Math.sqrt(Math.log(node.visits + 1) / e.visits);
        return ucb(b) - ucb(a);
      })[0];
      visited.push({ node, edge });
      node = this.node(edge.state);
      if (!edge.visits) break;
      yield;
    }
    const rollout = yield* this.greedy(node.state, this.rollouts);
    const scores = calculateFinalScores(rollout.state);
    const values = this.original.players.map(p => scores.rankings.find(s => s.playerId === p.playerId)?.totalPoints ?? 0);
    for (const { node: traversed, edge } of visited) {
      traversed.visits++;
      edge.visits++;
      edge.totals = edge.totals.map((total, i) => total + values[i]);
    }
    this.rollouts++;
  }

  private *project(): Generator<void> {
    const projection = yield* this.greedy(this.root.state, 0);
    this.plan = projection.path;
    this.score = calculateFinalScores(projection.state).rankings.find(p => p.playerId === this.playerId)?.totalPoints ?? null;
    this.planMessage = JSON.stringify(this.best()?.message);
  }

  private best(): Edge | undefined {
    return preferredEdge(this.root.edges, this.root.state.players.findIndex(p => p.playerId === this.root.actor));
  }

  *work(): Generator<void> {
    if (this.root.state.currentPhase === 'GAME_OVER') { yield* this.project(); return; }
    yield* this.expand(this.root, 1);
    yield* this.iteration();
    yield* this.project();
    while (true) {
      yield* this.iteration();
      if (this.rollouts % 4 === 0 || JSON.stringify(this.best()?.message) !== this.planMessage) yield* this.project();
    }
  }

  result(status: ScoreSolverResult['status'] = 'SEARCHING', message?: string): ScoreSolverResult {
    const best = this.best();
    const matches = this.planMessage === JSON.stringify(best?.message);
    const pending = this.original.pendingDecisions.some(d => d.playerId === this.playerId && d.decisionType !== 'PHASE_DISPLAY');
    return {
      requestId: this.requestId, status,
      immediateMove: this.root.actor === this.playerId && best?.message && (pending || (best.message.type === 'ACTIVATE_DEV'
        && this.root.state.currentPhase === this.original.currentPhase && this.root.state.roundNumber === this.original.roundNumber))
        ? describeMove(this.root.state, this.playerId, best.message) : null,
      path: matches ? this.plan : [], projectedScore: matches ? this.score : null,
      completedRollouts: this.rollouts, evaluatedMoves: this.evaluated,
      elapsedMs: Math.round(performance.now() - this.started),
      message: message ?? (this.rollouts ? 'Best found so far. Optimality is not proven.' : 'Quick legal suggestion; evaluating full-game continuations.'),
      assumesFutureDraftDraws: this.original.currentPhase === 'CITY_SELECTION',
    };
  }
}
