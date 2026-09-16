import type { ClientMessage, GameState, ScoreSolverMove, ScoreSolverResult } from '@khora/shared';
import { calculateFinalScores } from '../scoring-engine';
import { candidateMessages, describeMove } from './choices';
import { positionKey, settle, simulate, type SearchState } from './simulation';
import { getActivatableDevs } from '../city-dev-handlers';
import { potential, priority } from './evaluation';

interface PlanLink { move: ScoreSolverMove | null; next?: PlanLink; }
interface Edge { message: ClientMessage | null; state: SearchState; visits: number; totals: number[]; continuation?: number[]; line?: PlanLink; solved?: boolean; }
interface Node { state: SearchState; actor: string; messages: (ClientMessage | null)[] | null; cursor: number; edges: Edge[]; visits: number; solved: boolean; expanded: Set<string>; }
interface Traversal { node: Node; edge: Edge; }

export function preferredEdge(edges: Edge[], actorIndex: number): Edge | undefined {
  const value = (edge: Edge) => edge.continuation?.[actorIndex] ?? edge.totals[actorIndex] / edge.visits;
  return edges.filter(e => e.visits > 0).sort((a, b) => value(b) - value(a) || b.visits - a.visits)[0] ?? edges[0];
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
    if (this.original?.gameId !== state.gameId || this.playerId !== playerId) this.nodes.clear();
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
      // An anytime ability is a real local choice even while somebody else has
      // the pending turn. Passing this window lets that opponent continue.
      ?? state.players.find(p => p.playerId === this.playerId && !p.hasFlagged
        && !state.analysisPassed?.includes(p.playerId) && getActivatableDevs(p).length)?.playerId
      ?? state.pendingDecisions.find(d => d.decisionType !== 'PHASE_DISPLAY')?.playerId
      ?? [...state.players].sort((a, b) => Number(b.playerId === this.playerId) - Number(a.playerId === this.playerId))
        .find(p => !p.hasFlagged && !state.analysisPassed?.includes(p.playerId) && getActivatableDevs(p).length)?.playerId ?? '';
  }

  private node(state: GameState): Node {
    const key = positionKey(state);
    let node = this.nodes.get(key);
    if (!node) {
      node = { state, actor: this.actor(state), messages: null, cursor: 0, edges: [], visits: 0,
        solved: state.currentPhase === 'GAME_OVER', expanded: new Set() };
      // Keep caching recent continuations after the memory cap is reached.
      // Previously the cache froze, leaving all later branches uncached.
      if (this.nodes.size >= 2000) this.nodes.delete(this.nodes.keys().next().value!);
    }
    this.nodes.delete(key);
    this.nodes.set(key, node);
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
    if (!node.state.pendingDecisions.some(d => d.playerId === node.actor && d.decisionType !== 'PHASE_DISPLAY')) ranked.push({ message: null, rank: 0 });
    ranked.sort((a, b) => b.rank - a.rank);
    // Try distinct action sets before spending the rollout budget on alternate
    // dice permutations or different scroll spending for the same actions.
    const seen = new Set<string>();
    const first: (ClientMessage | null)[] = [], later: (ClientMessage | null)[] = [];
    for (const { message } of ranked) {
      const key = message?.type === 'ASSIGN_DICE'
        ? message.assignments.map(a => a.actionType).sort().join(',') : undefined;
      if (key && seen.has(key)) later.push(message);
      else { first.push(message); if (key) seen.add(key); }
    }
    node.messages = [...first, ...later];
  }

  private *expand(node: Node, limit: number): Generator<void> {
    yield* this.messages(node);
    while (node.cursor < node.messages!.length && node.edges.length < limit) {
      const message = node.messages![node.cursor++];
      const key = JSON.stringify(message);
      if (node.expanded.has(key)) continue;
      node.expanded.add(key);
      const next = message ? simulate(node.state, node.actor, message)
        : { ...node.state, analysisPassed: [...node.state.analysisPassed ?? [], node.actor] };
      this.evaluated++;
      if (next) node.edges.push({ message, state: settle(next, true), visits: 0, totals: node.state.players.map(() => 0) });
      yield;
    }
  }

  private *greedy(state: GameState, variation: number): Generator<void, { state: GameState; path: ScoreSolverMove[]; visited: Traversal[] }> {
    const path: ScoreSolverMove[] = [];
    const visited: Traversal[] = [];
    // Coherent whole-game alternatives expose investments a single greedy
    // policy misses. All are evaluated by actual terminal points, not this bias.
    const strategy = variation % 4;
    for (let depth = 0; depth < 700 && state.currentPhase !== 'GAME_OVER'; depth++) {
      const node = this.node(state);
      yield* this.expand(node, 8 + Math.floor(Math.sqrt(node.visits)));
      if (!node.edges.length) throw new Error(`No legal continuation for ${node.actor} in ${state.currentPhase}.`);
      const actorIndex = state.players.findIndex(p => p.playerId === node.actor);
      const learned = preferredEdge(node.edges.filter(e => e.visits > 0), actorIndex);
      const ordered = node.edges.map(edge => {
        const p = edge.state.players[actorIndex];
        let value = potential(edge.state, p, strategy);
        if (edge.message?.type === 'ASSIGN_DICE') value += priority(state, state.players[actorIndex], edge.message, strategy);
        if (edge.message?.type === 'PROGRESS_TRACK' && edge.state.progressSubmissions?.[node.actor]) {
          value += priority(state, state.players[actorIndex], edge.message, strategy);
        }
        if (edge.message?.type === 'DRAFT_CARD' || edge.message?.type === 'PICK_BAN_CARD') value += priority(state, state.players[actorIndex], edge.message);
        return { edge, value };
      }).sort((a, b) => b.value - a.value);
      const explore = variation > 0 && (depth + variation) % 13 === 0;
      const edge = explore ? ordered[Math.min(ordered.length - 1, variation % 3)].edge : (strategy === 0 ? learned : undefined) ?? ordered[0].edge;
      visited.push({ node, edge });
      if (edge.message) path.push(describeMove(state, node.actor, edge.message));
      state = edge.state;
      yield;
    }
    if (state.currentPhase !== 'GAME_OVER') throw new Error('Continuation exceeded the search safety limit.');
    return { state, path, visited };
  }

  private *iteration(): Generator<void> {
    let node = this.root;
    const visited: Traversal[] = [];
    let incumbent = this.best()?.line;
    // Alternate broad root exploration with improvements further along the
    // complete incumbent plan. Round-eight choices need search time too.
    const pivot = this.rollouts % 2 ? (this.rollouts * 17) % 100 : 0;
    for (let depth = 0; depth < 120 && node.state.currentPhase !== 'GAME_OVER'; depth++) {
      // Every legal candidate can enter as the position receives more search time.
      yield* this.expand(node, 8 + Math.floor(Math.sqrt(node.visits + 1) * 2));
      if (node.edges.every(edge => edge.solved) && node.cursor < node.messages!.length) yield* this.expand(node, node.edges.length + 1);
      if (!node.edges.length) throw new Error(`No legal move for ${node.actor}.`);
      const index = node.state.players.findIndex(p => p.playerId === node.actor);
      const follow = depth < pivot && incumbent;
      let planned: Edge | undefined;
      if (follow) {
        const message = incumbent!.move?.message ?? null;
        planned = node.edges.find(e => JSON.stringify(e.message) === JSON.stringify(message));
        if (!planned) {
          const next = message ? simulate(node.state, node.actor, message)
            : { ...node.state, analysisPassed: [...node.state.analysisPassed ?? [], node.actor] };
          if (next) {
            planned = { message, state: settle(next, true), visits: 0, totals: node.state.players.map(() => 0) };
            node.edges.push(planned);
            node.expanded.add(JSON.stringify(message));
          }
        }
      }
      if (planned?.solved) planned = undefined;
      const open = node.edges.filter(e => !e.solved);
      const candidates = open.length ? open : node.edges;
      const edge = planned ?? candidates.find(e => !e.visits) ?? [...candidates].sort((a, b) => {
        const ucb = (e: Edge) => e.totals[index] / e.visits + 18 * Math.sqrt(Math.log(node.visits + 1) / e.visits);
        return ucb(b) - ucb(a);
      })[0];
      visited.push({ node, edge });
      node = this.node(edge.state);
      incumbent = planned ? incumbent?.next : undefined;
      if (!planned && !edge.visits) break;
      yield;
    }
    const rollout = yield* this.greedy(node.state, this.rollouts);
    const scores = calculateFinalScores(rollout.state);
    const values = this.original.players.map(p => scores.rankings.find(s => s.playerId === p.playerId)?.totalPoints ?? 0);
    // Learn from decisions throughout the continuation, not just its shallow
    // prefix. Otherwise later-round choices repeat the initial heuristic forever.
    let continuation = values;
    let line: PlanLink | undefined;
    let solved = true;
    for (const { node: traversed, edge } of [...visited, ...rollout.visited].reverse()) {
      traversed.visits++;
      edge.visits++;
      edge.totals = edge.totals.map((total, i) => total + values[i]);
      const nextActor = this.actor(edge.state);
      const nextIndex = edge.state.players.findIndex(p => p.playerId === nextActor);
      // Evicting a cached node must not erase a stronger completed suffix. Its
      // next decision-maker (including an opponent) controls which suffix wins.
      if (solved || (!edge.solved && (!edge.continuation || nextIndex < 0 || continuation[nextIndex] > edge.continuation[nextIndex]))) {
        edge.continuation = continuation;
        edge.line = { move: edge.message ? describeMove(traversed.state, traversed.actor, edge.message) : null, next: line };
      }
      edge.solved ||= solved;
      traversed.solved = traversed.messages !== null && traversed.cursor === traversed.messages.length && traversed.edges.every(e => e.solved);
      // Deterministic max-n backup: future players choose their strongest known
      // continuation. Do not average a newly learned plan with obsolete bad play.
      const selected = preferredEdge(traversed.edges, traversed.state.players.findIndex(p => p.playerId === traversed.actor));
      continuation = selected?.continuation ?? continuation;
      line = selected?.line ?? edge.line;
      solved = traversed.solved;
    }
    this.rollouts++;
  }

  private *project(): Generator<void> {
    const best = this.best();
    if (best?.continuation) {
      this.plan = [];
      for (let link = best.line; link; link = link.next) if (link.move) this.plan.push(link.move);
      this.score = best.continuation[this.root.state.players.findIndex(p => p.playerId === this.playerId)];
    } else {
      const projection = yield* this.greedy(this.root.state, 0);
      this.plan = projection.path;
      this.score = calculateFinalScores(projection.state).rankings.find(p => p.playerId === this.playerId)?.totalPoints ?? null;
    }
    this.planMessage = JSON.stringify(this.best()?.message);
  }

  private best(): Edge | undefined {
    return preferredEdge(this.root.edges, this.root.state.players.findIndex(p => p.playerId === this.root.actor));
  }

  *work(): Generator<void> {
    if (this.root.solved) { yield* this.project(); return; }
    yield* this.expand(this.root, 1);
    yield* this.iteration();
    yield* this.project();
    while (!this.root.solved) {
      yield* this.iteration();
      if (this.rollouts % 4 === 0 || JSON.stringify(this.best()?.message) !== this.planMessage) yield* this.project();
    }
    yield* this.project();
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
