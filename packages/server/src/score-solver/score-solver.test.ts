import { describe, expect, it } from 'vitest';
import type { ClientMessage, DraftMode, GameState, PlayerState } from '@khora/shared';
import { ALL_CITIES, ALL_POLITICS_CARDS, EXPANSION_POLITICS_CARDS, STARTING_EVENT, RANDOM_EVENTS, FINAL_EVENT, getAllAchievements } from '../game-data';
import { GameEngine } from '../game-engine';
import { calculateFinalScores } from '../scoring-engine';
import { makeTestGameState, makeTestPlayer, makeTestKnowledgeToken, makeTestPoliticsCard } from '../test-helpers';
import { benchmarkPosition } from './benchmark-position';
import { actionChoices, candidateMessages } from './choices';
import { positionKey, restoreSolverSnapshot, settle, simulate, solverSnapshot } from './simulation';
import { preferredEdge, ScoreSearch } from './search';
import { makeDefaultCentralBoardTokens } from '../integration';
import { DicePhaseManager } from '../phases/dice-phase';

const card = (id: string) => [...ALL_POLITICS_CARDS, ...EXPANSION_POLITICS_CARDS].find(c => c.id === id)!;
function pending(type: GameState['pendingDecisions'][number]['decisionType'], playerId = 'player-1') {
  return { playerId, decisionType: type, timeoutAt: Date.now() + 30_000, options: { achievementId: 'test' } };
}
function finishProjection(search: ScoreSearch, budgetMs = 15_000) {
  const work = search.work();
  const started = performance.now();
  let firstMoveMs: number | null = null;
  while (performance.now() - started < budgetMs) {
    const done = work.next().done;
    const result = search.result();
    if (result.immediateMove && firstMoveMs === null) firstMoveMs = performance.now() - started;
    if (result.projectedScore !== null || done) return { result, firstMoveMs, durationMs: performance.now() - started };
  }
  throw new Error(`No full-game projection within ${budgetMs}ms: ${JSON.stringify(search.result())}`);
}

function replayProjection(initial: GameState, path: ReturnType<ScoreSearch['result']>['path']): GameState {
  let state = initial;
  for (const move of path) {
    if (move.message.type !== 'ACTIVATE_DEV') state = settle(state);
    // Preserve optional activation windows, but automatically pass display pauses
    // when the recorded continuation moves into the next phase.
    for (let i = 0; i < 40 && (state.currentPhase !== move.phase || state.roundNumber !== move.round); i++) {
      expect(state.pendingDecisions.every(d => d.decisionType === 'PHASE_DISPLAY')).toBe(true);
      state = simulate(state, state.pendingDecisions[0]?.playerId ?? '', null)!;
    }
    const next = simulate(state, move.playerId, move.message);
    expect(next, `${move.instruction}; ${JSON.stringify({ move, phase: state.currentPhase, pending: state.pendingDecisions, players: state.players.map(p => ({ id: p.playerId, coins: p.coins, slots: p.actionSlots })) })}`).not.toBeNull();
    state = next!;
  }
  return settle(state);
}

describe('score solver rules and search', () => {
  it('finds a high-scoring card beyond the old eight-choice rollout cutoff immediately', () => {
    const handCards = Array.from({ length: 12 }, (_, i) => makeTestPoliticsCard(`endgame-${i}`, {
      cost: 0, knowledgeRequirement: { green: 0, blue: 0, red: 0 }, type: 'END_GAME',
      endGameScoring: { type: 'CUSTOM', description: 'Fixed points', calculate: () => i === 11 ? 40 : 1 },
    }));
    const state = makeTestGameState({ roundNumber: 9, currentPhase: 'ACTIONS',
      players: [makeTestPlayer({ handCards, actionSlots: [{ actionType: 'POLITICS', assignedDie: 5, citizenCost: 0, resolved: false }, null, null] })],
      pendingDecisions: [pending('RESOLVE_ACTION')],
    });
    const search = new ScoreSearch(); search.reset(state, 'player-1', 'card-order');
    const { result } = finishProjection(search);
    expect(result.immediateMove?.message).toMatchObject({ type: 'RESOLVE_ACTION', choices: { targetCardId: 'endgame-11' } });
    expect(calculateFinalScores(replayProjection(state, result.path)).rankings[0].totalPoints).toBe(result.projectedScore);
    expect(result.projectedScore).toBeGreaterThanOrEqual(40);
  });

  it('retains every distinct dice action/resource outcome without equivalent permutations', () => {
    const state = benchmarkPosition('athens', 1);
    const player = state.players[0];
    player.diceRoll = [5, 5, 5];
    player.citizenTrack = 15;
    const assignments = [...candidateMessages(state, player.playerId)].filter(m => m.type === 'ASSIGN_DICE');
    // Seven actions, three distinct choices: 35 sets rather than 210 permutations.
    expect(assignments).toHaveLength(35);
    for (const message of assignments) expect(simulate(state, player.playerId, message)).not.toBeNull();
  });

  it.each([1, 2])('improves and replays the retained Athens opening plan for deal %i', seed => {
    const state = benchmarkPosition('athens', seed);
    const original = solverSnapshot(state);
    const search = new ScoreSearch(); search.reset(state, 'player-1', `quality-${seed}`);
    const work = search.work();
    let checked = 0;
    while (search.result().completedRollouts < 80) {
      work.next();
      const result = search.result();
      if (result.projectedScore !== null && result.completedRollouts >= checked + 20) {
        const replay = replayProjection(state, result.path);
        expect(calculateFinalScores(replay).rankings.find(p => p.playerId === 'player-1')?.totalPoints).toBe(result.projectedScore);
        expect(result.path[0].message).toEqual(result.immediateMove?.message);
        checked = result.completedRollouts;
      }
    }
    expect(search.result().projectedScore).toBeGreaterThanOrEqual(60);
    expect(solverSnapshot(state)).toBe(original);
  }, 30_000);

  it('restores executable scoring, event, achievement and city data from a full snapshot', () => {
    const state = makeTestGameState({ eventDeck: [FINAL_EVENT], currentEvent: STARTING_EVENT,
      players: [makeTestPlayer({ playedCards: [card('bank'), card('hades')], coins: 12 })],
      availableAchievements: getAllAchievements() });
    const restored = restoreSolverSnapshot(solverSnapshot(state));
    expect(calculateFinalScores(restored)).toEqual(calculateFinalScores(state));
    expect(typeof restored.currentEvent!.gloryCondition.evaluate).toBe('function');
    expect(typeof restored.availableAchievements[0].condition.evaluate).toBe('function');
    expect(restored.predeterminedDice).toEqual(state.predeterminedDice);
  });

  it('tracks hidden information changes but ignores clock-only changes', () => {
    const state = makeTestGameState({ pendingDecisions: [pending('ROLL_DICE')] });
    expect(positionKey({ ...state, updatedAt: state.updatedAt + 1, pendingDecisions: [pending('ROLL_DICE')] })).toBe(positionKey(state));
    expect(positionKey({ ...state, eventDeck: [FINAL_EVENT] })).not.toBe(positionKey(state));
    expect(positionKey({ ...state, politicsDeck: [card('bank')] })).not.toBe(positionKey(state));
    expect(positionKey({ ...state, predeterminedDice: {} })).not.toBe(positionKey(state));
  });

  it('keeps compact position identities stable across snapshots and sensitive to asset changes', () => {
    const state = benchmarkPosition('athens', 4);
    expect(positionKey(restoreSolverSnapshot(solverSnapshot(state)))).toBe(positionKey(state));
    const original = state.players[0].handCards[0];
    const changed = { ...state, players: state.players.map((p, i) => i ? p : {
      ...p, handCards: [{ ...original, cost: original.cost + 1 }, ...p.handCards.slice(1)],
    }) };
    expect(positionKey(changed)).not.toBe(positionKey(state));
    expect(positionKey({ ...state, politicsDeck: [...state.politicsDeck].reverse() })).not.toBe(positionKey(state));
    expect(positionKey({ ...state, currentEvent: { ...STARTING_EVENT, triggerDuringDice: false } })).not.toBe(positionKey(state));
    const custom = makeTestPoliticsCard('custom-score', { type: 'END_GAME', endGameScoring: { type: 'CUSTOM', description: 'points', calculate: () => 1 } });
    const alternative = { ...custom, endGameScoring: { ...custom.endGameScoring!, calculate: () => 2 } };
    expect(positionKey({ ...state, politicsDeck: [custom] })).not.toBe(positionKey({ ...state, politicsDeck: [alternative] }));
  });

  it('finishes a fully searched endgame and matches exhaustive legal progress sequences', () => {
    const state = makeTestGameState({ currentPhase: 'PROGRESS', roundNumber: 9,
      players: [makeTestPlayer({ coins: 12, philosophyTokens: 2, economyTrack: 3, militaryTrack: 3,
        playedCards: [card('proskenion')],
        knowledgeTokens: Array.from({ length: 4 }, (_, i) => makeTestKnowledgeToken({ id: `major-${i}`, tokenType: 'MAJOR' })),
      })], pendingDecisions: [pending('PROGRESS_TRACK')] });
    // Independent enumeration includes all track orders, not just the solver's multisets.
    const tracks = ['ECONOMY', 'CULTURE', 'MILITARY'] as const;
    const messages: ClientMessage[] = [{ type: 'SKIP_PHASE' }];
    for (const first of tracks) {
      messages.push({ type: 'PROGRESS_TRACK', advancement: { track: first } });
      for (const second of tracks) {
        messages.push({ type: 'PROGRESS_TRACK', advancement: { track: first }, extraTracks: [{ track: second }] });
        for (const third of tracks) messages.push({ type: 'PROGRESS_TRACK', advancement: { track: first }, extraTracks: [{ track: second }, { track: third }] });
      }
    }
    const exact = Math.max(...messages.flatMap(message => {
      const next = simulate(state, 'player-1', message);
      return next ? [calculateFinalScores(settle(next)).rankings[0].totalPoints] : [];
    }));
    expect(exact).toBe(17);
    const search = new ScoreSearch(); search.reset(state, 'player-1', 'exact-progress');
    const work = search.work();
    let done = false;
    for (let i = 0; i < 10_000 && !done; i++) done = Boolean(work.next().done);
    expect(done).toBe(true);
    const result = search.result();
    expect(result.projectedScore).toBe(exact);
    expect(calculateFinalScores(replayProjection(state, result.path)).rankings[0].totalPoints).toBe(exact);
    search.reset(restoreSolverSnapshot(solverSnapshot(state)), 'player-1', 'reuse-solved');
    expect(search.work().next().done).toBe(true);
    expect(search.result().completedRollouts).toBe(0);
    expect(search.result().projectedScore).toBe(exact);
    expect(search.result().immediateMove?.message).toEqual(result.immediateMove?.message);
  });

  it('simulates repeatably without mutating the input, clock or random generator', () => {
    const state = makeTestGameState({ currentPhase: 'ACTIONS', pendingDecisions: [pending('RESOLVE_ACTION')], players: [makeTestPlayer({ coins: 12,
      actionSlots: [{ actionType: 'TRADE', assignedDie: 3, citizenCost: 0, resolved: false }, null, null] })] });
    const before = solverSnapshot(state);
    const oldNow = Date.now, oldRandom = Math.random;
    const message: ClientMessage = { type: 'RESOLVE_ACTION', actionType: 'TRADE', choices: { buyMinorKnowledge: true, minorKnowledgeColor: 'GREEN' } };
    const first = simulate(state, 'player-1', message)!;
    const second = simulate(state, 'player-1', message)!;
    expect(positionKey(first)).toBe(positionKey(second));
    expect(solverSnapshot(state)).toBe(before);
    expect(Date.now).toBe(oldNow);
    expect(Math.random).toBe(oldRandom);
  });

  it('uses each acting player’s own final score, never score margin', () => {
    const state = makeTestGameState();
    const edges = [
      { message: { type: 'SKIP_PHASE' } as ClientMessage, state, visits: 1, totals: [20, 30] },
      { message: { type: 'ROLL_DICE' } as ClientMessage, state, visits: 1, totals: [18, 4] },
    ];
    expect(preferredEdge(edges, 0)).toBe(edges[0]);
    expect(preferredEdge(edges, 1)).toBe(edges[0]);
    edges[1].totals = [10, 40];
    expect(preferredEdge(edges, 1)).toBe(edges[1]);
  });

  it('chooses Glory over Tax when only Glory increases final points', () => {
    const state = makeTestGameState({ currentPhase: 'ACHIEVEMENT', roundNumber: 9,
      players: [makeTestPlayer({ knowledgeTokens: [makeTestKnowledgeToken({ tokenType: 'MAJOR' })] })],
      pendingDecisions: [pending('ACHIEVEMENT_TRACK_CHOICE')] });
    const search = new ScoreSearch(); search.reset(state, 'player-1', 'end');
    const work = search.work();
    for (let i = 0; i < 800; i++) work.next();
    const result = search.result();
    expect(result.immediateMove?.message).toMatchObject({ type: 'CLAIM_ACHIEVEMENT', trackChoice: 'GLORY' });
    expect(result.projectedScore).toBe(1);
    expect(result.message).toContain('not proven');
  });

  it('considers optional Thebes activations during the last display pause, and can decline', () => {
    for (const majors of [0, 6]) {
      const state = makeTestGameState({ currentPhase: 'ACHIEVEMENT', roundNumber: 9,
        players: [makeTestPlayer({ cityId: 'thebes', developmentLevel: 2, gloryTrack: 2,
          knowledgeTokens: Array.from({ length: majors }, (_, i) => makeTestKnowledgeToken({ id: `major-${i}`, tokenType: 'MAJOR' })) })],
        pendingDecisions: [pending('PHASE_DISPLAY', '__display__')] });
      const search = new ScoreSearch(); search.reset(state, 'player-1', `thebes-${majors}`);
      const work = search.work();
      for (let i = 0; i < 2000; i++) work.next();
      const result = search.result();
      expect(result.projectedScore).toBe(majors ? 12 : 8);
      expect(result.immediateMove?.message.type ?? null).toBe(majors ? null : 'ACTIVATE_DEV');
      expect(calculateFinalScores(replayProjection(state, result.path)).rankings[0].totalPoints).toBe(result.projectedScore);
    }
  });

  it('offers an anytime ability while an opponent is choosing, without forcing its use', () => {
    for (const majors of [0, 6]) {
      const state = makeTestGameState({ currentPhase: 'ACHIEVEMENT', roundNumber: 9,
        players: [makeTestPlayer({ cityId: 'thebes', developmentLevel: 2, gloryTrack: 2,
          knowledgeTokens: Array.from({ length: majors }, (_, i) => makeTestKnowledgeToken({ id: `major-${i}`, tokenType: 'MAJOR' })) }),
        makeTestPlayer({ playerId: 'player-2' })],
        pendingDecisions: [pending('ACHIEVEMENT_TRACK_CHOICE', 'player-2')] });
      const search = new ScoreSearch(); search.reset(state, 'player-1', `out-of-turn-${majors}`);
      const work = search.work();
      let offered = false;
      for (let i = 0; i < 2000; i++) {
        const done = work.next().done;
        offered ||= search.result().immediateMove?.message.type === 'ACTIVATE_DEV';
        if (done) break;
      }
      const result = search.result();
      expect(offered).toBe(true);
      expect(result.projectedScore).toBe(majors ? 12 : 8);
      if (majors) expect(result.immediateMove).toBeNull();
      expect(calculateFinalScores(replayProjection(state, result.path)).rankings.find(p => p.playerId === 'player-1')?.totalPoints).toBe(result.projectedScore);
    }
  });

  it('includes repeated progress, free bonuses and paid extra advancements', () => {
    const player = makeTestPlayer({ coins: 100, philosophyTokens: 4, playedCards: [card('reformists')] });
    const state = makeTestGameState({ currentPhase: 'PROGRESS', players: [player], pendingDecisions: [pending('PROGRESS_TRACK')] });
    const messages = [...candidateMessages(state, 'player-1')];
    expect(messages.some(m => m.type === 'PROGRESS_TRACK' && m.advancement.track === 'CULTURE' && m.bonusTracks?.[0]?.track === 'CULTURE' && m.extraTracks?.[0]?.track === 'CULTURE')).toBe(true);
    for (const message of messages) expect(simulate(state, 'player-1', message)).not.toBeNull();
  });

  it.each(['TOKEN', 'COINS', 'DRAW', 'POLITICS', 'ENLIST', 'REWARD', 'GLORY'] as const)('covers expansion %s choices with legal alternatives', kind => {
    const state = makeTestGameState({ currentPhase: 'TAXATION',
      players: [makeTestPlayer({ coins: 10, handCards: [card('amnesty-for-socrates')], knowledgeTokens: [makeTestKnowledgeToken({ tokenType: 'MINOR' })] })],
      politicsDeck: [card('bank')], pendingDecisions: [pending('EXPANSION_CHOICE')],
      suspendedDecisions: [{ playerId: '__display__', decisionType: 'PHASE_DISPLAY', timeoutAt: 1000, options: null }],
      expansionChoices: [{ playerId: 'player-1', cardId: 'demagorgy', kind, amount: 3, cards: [card('bank')] }] });
    const messages = [...candidateMessages(state, 'player-1')];
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.filter(m => simulate(state, 'player-1', m))).toHaveLength(messages.length);
  });

  it('covers choice-bearing cards, city developments and double exploration', () => {
    const player: PlayerState = makeTestPlayer({ cityId: 'miletus', coins: 50, philosophyTokens: 20,
      handCards: [card('scholarly-welcome'), card('ostracism')], playedCards: [card('bank')] });
    const state = makeTestGameState({ players: [player], centralBoardTokens: [makeTestKnowledgeToken({ id: 'a' }), makeTestKnowledgeToken({ id: 'b' })] });
    expect([...actionChoices(state, player, 'POLITICS')]).toHaveLength(4);
    expect([...actionChoices(state, player, 'DEVELOPMENT')]).toHaveLength(9);
    const thebes = { ...player, cityId: 'thebes', developmentLevel: 3 };
    expect([...actionChoices(state, thebes, 'MILITARY')].some(c => c.explorationTokenId === 'a' && c.secondExplorationTokenId === 'b')).toBe(true);
    expect([...candidateMessages({ ...state, players: [{ ...thebes, gloryTrack: 2 }] }, 'player-1')]).toContainEqual({ type: 'ACTIVATE_DEV', devId: 'thebes-dev-2' });
  });

  it.each(['STANDARD', 'PICK_BAN'] as DraftMode[])('returns and replays a complete %s game from city selection', mode => {
    const engine = new GameEngine(mode);
    const initial = engine.initializeGame([{ playerId: 'player-1', playerName: 'Alice' }, { playerId: 'player-2', playerName: 'Bob' }],
      ALL_CITIES, [STARTING_EVENT, ...RANDOM_EVENTS.slice(0, 7), FINAL_EVENT], [...ALL_POLITICS_CARDS, ...EXPANSION_POLITICS_CARDS], getAllAchievements(),
      [makeTestKnowledgeToken({ id: 'central', tokenType: 'MAJOR', militaryRequirement: 1, skullValue: 0 })], mode);
    const state = restoreSolverSnapshot(solverSnapshot(initial));
    state.gameId = `draft-test-${mode}`;
    state.predeterminedDice = makeTestGameState({ players: state.players }).predeterminedDice;
    state.draftState!.cityDraft!.pickOrder = ['player-1', 'player-2'];
    state.draftState!.cityDraft!.offeredCities = { 'player-1': ALL_CITIES.slice(0, 3).map(c => c.id) };
    state.pendingDecisions = [pending('SELECT_CITY')];
    const actor = state.pendingDecisions[0].playerId;
    const search = new ScoreSearch(); search.reset(state, actor, mode);
    const { result, firstMoveMs, durationMs } = finishProjection(search);
    expect(firstMoveMs).not.toBeNull();
    expect(firstMoveMs!).toBeLessThan(1500);
    expect(result.completedRollouts).toBeGreaterThan(0);
    expect(result.path.length).toBeGreaterThan(30);
    const replay = replayProjection(state, result.path);
    expect(replay.currentPhase).toBe('GAME_OVER');
    expect(calculateFinalScores(replay).rankings.find(p => p.playerId === actor)?.totalPoints).toBe(result.projectedScore);
    console.log(`${mode}: first move ${firstMoveMs?.toFixed(0)}ms, full path ${durationMs.toFixed(0)}ms, ${result.evaluatedMoves} moves evaluated`);
  }, 20_000);

  it.each(ALL_CITIES.map(c => c.id))('completes a four-player %s continuation with the full board and expansion cards', cityId => {
    const players = Array.from({ length: 4 }, (_, i) => makeTestPlayer({
      playerId: `player-${i + 1}`, playerName: `Player ${i + 1}`, cityId: i ? ALL_CITIES[(i + 2) % ALL_CITIES.length].id : cityId,
      coins: 12, philosophyTokens: 3, cultureTrack: 4, militaryTrack: 3, economyTrack: 3,
      handCards: [...ALL_POLITICS_CARDS, ...EXPANSION_POLITICS_CARDS].slice(i * 5, i * 5 + 5),
    }));
    const state = new DicePhaseManager().onEnter(makeTestGameState({ roundNumber: 4, currentPhase: 'DICE', players,
      centralBoardTokens: makeDefaultCentralBoardTokens(), availableAchievements: getAllAchievements(),
      politicsDeck: [...ALL_POLITICS_CARDS, ...EXPANSION_POLITICS_CARDS].slice(20),
      currentEvent: RANDOM_EVENTS[0], eventDeck: [...RANDOM_EVENTS.slice(1, 5), FINAL_EVENT] }));
    const search = new ScoreSearch(); search.reset(state, 'player-1', cityId);
    const { result, durationMs } = finishProjection(search);
    const replay = replayProjection(state, result.path);
    expect(replay.currentPhase).toBe('GAME_OVER');
    expect(calculateFinalScores(replay).rankings.find(p => p.playerId === 'player-1')?.totalPoints).toBe(result.projectedScore);
    expect(durationMs).toBeLessThan(2500);
  }, 15_000);
});
