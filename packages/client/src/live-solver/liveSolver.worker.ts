import { buildReferenceLinePreview, createLiveSolverSearchSession, gameStateFromLiveSolverSnapshot, runLiveSolver, validateLiveSolverLine } from '@khora/server';
import type { ClientMessage, LiveSolverReferenceLine, LiveSolverRequestOptions, LiveSolverResult, LiveSolverSnapshot } from '../types';
import { solverPositionKey } from './solverPosition';

interface WorkerRequest {
  requestId: string;
  playerId: string;
  snapshot: LiveSolverSnapshot;
  options: LiveSolverRequestOptions;
}

interface WorkerResponse {
  requestId: string;
  result: LiveSolverResult;
  done?: boolean;
}

const workerScope = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
  postMessage(message: WorkerResponse): void;
};

const STRONG_LINE_THRESHOLD = 90;
const MAX_LEARNED_LINES = 500;
const DB_NAME = 'khora-live-solver';
const DB_VERSION = 1;
const STORE_RESULTS = 'results';
const STORE_LINES = 'referenceLines';

let referenceLinesPromise: Promise<LiveSolverReferenceLine[]> | null = null;
let persistenceChain: Promise<void> = Promise.resolve();
const persistedQuality = new Map<string, number>();
let requestGeneration = 0;
let previousLine: LiveSolverReferenceLine | null = null;
const searchSession = createLiveSolverSearchSession();

workerScope.addEventListener('message', (event) => {
  void handleRequest(event.data);
});

async function handleRequest(request: WorkerRequest): Promise<void> {
  const generation = ++requestGeneration;
  const isCurrent = () => generation === requestGeneration;
  const { requestId, playerId, snapshot, options } = request;
  try {
    const state = gameStateFromLiveSolverSnapshot(snapshot);
    const referenceLines = options.referenceLines?.length
      ? options.referenceLines
      : await loadReferenceLines();
    const mergedOptions = {
      ...options,
      referenceLines: previousLine ? [previousLine, ...referenceLines] : referenceLines,
      referenceLineWeight: options.referenceLineWeight ?? 32,
    };
    const cacheKey = solverPositionKey(snapshot, playerId);
    let cached = await loadCachedResult(cacheKey, requestId);
    if (!isCurrent()) return;
    if (cached && !validateLiveSolverLine(state, playerId, cached.rounds.flatMap(round => round.moves), cached.verifiedFinalScore).valid) cached = null;
    if (cached) {
      workerScope.postMessage({ requestId, result: cached });
    }

    const preview = buildReferenceLinePreview(state, playerId, requestId, mergedOptions);
    if (preview && Number.isFinite(resultQuality(preview)) && (!cached || resultQuality(preview) > resultQuality(cached))) {
      workerScope.postMessage({ requestId, result: preview });
      queuePersistence(snapshot, cacheKey, preview);
      await flushPersistence(120);
    }

    if (!isCurrent()) return;
    await runProgressiveSearch(state, playerId, requestId, snapshot, cacheKey, mergedOptions, betterResult(cached, preview, playerId), isCurrent);
  } catch (error) {
    if (!isCurrent()) return;
    workerScope.postMessage({
      requestId,
      result: errorResult(requestId, playerId, error),
      done: true,
    });
  }
}

async function loadReferenceLines(): Promise<LiveSolverReferenceLine[]> {
  referenceLinesPromise ??= loadAllReferenceLines();
  return referenceLinesPromise;
}

async function loadAllReferenceLines(): Promise<LiveSolverReferenceLine[]> {
  const [assetLines, learnedLines] = await Promise.all([
    loadReferenceLinesFromPublicAsset(),
    loadLearnedReferenceLines(),
  ]);
  return mergeReferenceLines([...learnedLines, ...assetLines]);
}

async function loadReferenceLinesFromPublicAsset(): Promise<LiveSolverReferenceLine[]> {
  const urls = [
    '/live-solver-reference-lines.json',
    new URL('live-solver-reference-lines.json', self.location.href).toString(),
    `${self.location.origin}/live-solver-reference-lines.json`,
  ];
  for (const url of Array.from(new Set(urls))) {
    try {
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) continue;
      const lines = toReferenceLines(await response.json());
      if (lines.length > 0) return lines;
    } catch {
      // Try the next URL form; some dev/prod hosts mount workers differently.
    }
  }
  return [];
}

function toReferenceLines(payload: unknown): LiveSolverReferenceLine[] {
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as { lines?: unknown; records?: unknown };
  if (Array.isArray(record.lines)) return sanitizeReferenceLines(record.lines);
  if (Array.isArray(record.records)) {
    return sanitizeReferenceLines(record.records.map(item => {
      const source = item as {
        score?: unknown;
        projectedMargin?: unknown;
        scenarioKey?: unknown;
        cityId?: unknown;
        tags?: unknown;
        rounds?: Array<{ moves?: unknown[] }>;
      };
      return {
        score: source.score,
        projectedMargin: source.projectedMargin,
        scenarioKey: source.scenarioKey,
        cityId: source.cityId,
        tags: source.tags,
        moves: source.rounds?.flatMap(round => round.moves ?? []),
      };
    }));
  }
  return [];
}

function sanitizeReferenceLines(lines: unknown[]): LiveSolverReferenceLine[] {
  const seen = new Set<string>();
  return lines.flatMap(line => {
    if (!line || typeof line !== 'object') return [];
    const record = line as {
      score?: unknown;
      projectedMargin?: unknown;
      scenarioKey?: unknown;
      cityId?: unknown;
      tags?: unknown;
      moves?: unknown;
    };
    if (typeof record.score !== 'number' || !Array.isArray(record.moves)) return [];

    const moves = record.moves.flatMap(move => sanitizeReferenceMove(move));
    if (moves.length === 0) return [];
    const key = JSON.stringify(moves.map(move => move.message));
    if (seen.has(key)) return [];
    seen.add(key);

    return [{
      score: record.score,
      projectedMargin: typeof record.projectedMargin === 'number' ? record.projectedMargin : null,
      scenarioKey: typeof record.scenarioKey === 'string' ? record.scenarioKey : undefined,
      cityId: typeof record.cityId === 'string' ? record.cityId : undefined,
      tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === 'string') : undefined,
      moves,
    }];
  });
}

function sanitizeReferenceMove(move: unknown): LiveSolverReferenceLine['moves'] {
  if (!move || typeof move !== 'object') return [];
  const record = move as {
    round?: unknown;
    phase?: unknown;
    decisionType?: unknown;
    message?: unknown;
  };
  if (typeof record.round !== 'number' || typeof record.phase !== 'string' || typeof record.decisionType !== 'string') return [];
  return [{
    round: record.round,
    phase: record.phase as LiveSolverReferenceLine['moves'][number]['phase'],
    decisionType: record.decisionType as LiveSolverReferenceLine['moves'][number]['decisionType'],
    message: isClientMessage(record.message) ? record.message : null,
  }];
}

function isClientMessage(value: unknown): value is ClientMessage {
  return !!value && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}

async function runProgressiveSearch(
  state: ReturnType<typeof gameStateFromLiveSolverSnapshot>,
  playerId: string,
  requestId: string,
  snapshot: LiveSolverSnapshot,
  cacheKey: string,
  requestedOptions: LiveSolverRequestOptions,
  initialBest: LiveSolverResult | null = null,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const startedAt = Date.now();
  let cumulativeSearchedNodes = 0;
  let cumulativeProofNodes = 0;
  let bestResult: LiveSolverResult | null = initialBest;

  for (let iteration = 0; ; iteration++) {
    if (!isCurrent()) return;
    const baseSearchedNodes = cumulativeSearchedNodes;
    const baseProofNodes = cumulativeProofNodes;
    let iterationSearchedNodes = 0;
    let iterationProofNodes = 0;
    const iterationOptions = progressiveOptions(iteration, requestedOptions);

    const publish = (candidate: LiveSolverResult, done = false) => {
      if (!isCurrent()) return;
      iterationSearchedNodes = Math.max(iterationSearchedNodes, candidate.searchedNodes);
      iterationProofNodes = Math.max(iterationProofNodes, candidate.proofNodes);
      if (!bestResult || resultQuality(candidate) > resultQuality(bestResult)) {
        if (Number.isFinite(resultQuality(candidate))) bestResult = candidate;
      }
      if (!bestResult) {
        workerScope.postMessage({ requestId, result: {
          ...candidate,
          status: 'UNAVAILABLE',
          message: 'Searching for a replay-verified full-game line.',
          currentMove: null,
          rounds: [],
          projections: [],
          computeMs: Date.now() - startedAt,
          searchedNodes: baseSearchedNodes + iterationSearchedNodes,
        } });
        return;
      }

      const result = {
        ...(bestResult ?? candidate),
        generatedAt: Date.now(),
        computeMs: Date.now() - startedAt,
        searchedNodes: baseSearchedNodes + iterationSearchedNodes,
        proofNodes: baseProofNodes + iterationProofNodes,
        proofReason: withReferenceBookStatus((bestResult ?? candidate).proofReason, requestedOptions.referenceLines?.length ?? 0),
        message: done
          ? (bestResult ?? candidate).message
          : 'Best line found so far. Search is still running; close the panel to stop.',
      };
      workerScope.postMessage({ requestId, result, done });
      previousLine = {
        score: result.verifiedFinalScore!, projectedMargin: result.projectedMargin,
        cityId: snapshot.players.find(player => player.playerId === playerId)?.cityId,
        moves: result.rounds.flatMap(round => round.moves),
      };
      queuePersistence(snapshot, cacheKey, result);
    };

    const result = runLiveSolver(state, playerId, requestId, iterationOptions, publish, searchSession);
    if (result.status !== 'READY') {
      workerScope.postMessage({ requestId, result, done: true });
      return;
    }
    publish(result, result.proofStatus === 'PROVEN_OPTIMAL');

    cumulativeSearchedNodes = baseSearchedNodes + Math.max(iterationSearchedNodes, result.searchedNodes);
    cumulativeProofNodes = baseProofNodes + Math.max(iterationProofNodes, result.proofNodes);
    await flushPersistence();
    if (result.proofStatus === 'PROVEN_OPTIMAL') return;
    await yieldToBrowser();
  }
}

function betterResult(
  current: LiveSolverResult | null,
  candidate: LiveSolverResult | null,
  playerId: string,
): LiveSolverResult | null {
  void playerId;
  if (!candidate || !Number.isFinite(resultQuality(candidate))) return current;
  if (!current) return candidate;
  return resultQuality(candidate) > resultQuality(current) ? candidate : current;
}

function progressiveOptions(iteration: number, requested: LiveSolverRequestOptions): LiveSolverRequestOptions {
  const levels: LiveSolverRequestOptions[] = [
    { timeBudgetMs: 1500, beamWidth: 96, targetBranches: 24, completionWidth: 32, maxDecisionPlies: 900 },
    { timeBudgetMs: 5000, beamWidth: 160, targetBranches: 40, completionWidth: 64, maxDecisionPlies: 1500 },
    { timeBudgetMs: 15000, beamWidth: 320, targetBranches: 72, completionWidth: 128, maxDecisionPlies: 2500 },
    { timeBudgetMs: 45000, beamWidth: 512, targetBranches: 96, completionWidth: 192, maxDecisionPlies: 3500 },
    { timeBudgetMs: 120000, beamWidth: 768, targetBranches: 128, completionWidth: 256, maxDecisionPlies: 5000 },
    { timeBudgetMs: 300000, beamWidth: 1024, targetBranches: 160, completionWidth: 320, maxDecisionPlies: 6000 },
  ];
  const level = levels[Math.min(iteration, levels.length - 1)];
  return {
    ...requested,
    ...level,
    timeBudgetMs: iteration === 0 ? 1500 : 2000,
    beamWidth: Math.min(level.beamWidth ?? 192, 256),
    opponentBranches: 1,
    exactTimeBudgetMs: 0,
    exactNodeLimit: 0,
    progressIntervalMs: 1000,
    skipExactSearch: true,
  };
}

function withReferenceBookStatus(reason: string, referenceLineCount: number): string {
  const suffix = `Reference book: ${referenceLineCount} line${referenceLineCount === 1 ? '' : 's'} loaded.`;
  return reason.includes('Reference book:') ? reason : `${reason} ${suffix}`;
}

function resultQuality(result: LiveSolverResult): number {
  if (result.status !== 'READY') return -Infinity;
  const ownProjection = result.projections.find(score => score.playerId === result.playerId);
  const ownTotal = ownProjection?.projectedTotal ?? 0;
  if (result.horizon !== 'FULL_GAME' || result.verifiedFinalScore !== ownTotal) return -Infinity;
  const moves = result.rounds.flatMap(round => round.moves);
  const followability = -moves.reduce((sum, move) => sum + move.estimatedSeconds * 0.03, 0) - moves.length * 0.08;
  return (result.horizon === 'FULL_GAME' ? 1_000_000 : 0)
    + ownTotal * 1000
    + followability;
}

function resultToReferenceLine(snapshot: LiveSolverSnapshot, result: LiveSolverResult): LiveSolverReferenceLine | null {
  if (!Number.isFinite(resultQuality(result))) return null;
  const ownTotal = result.projections.find(score => score.playerId === result.playerId)?.projectedTotal;
  if (typeof ownTotal !== 'number' || ownTotal < STRONG_LINE_THRESHOLD) return null;
  const target = snapshot.players.find(player => player.playerId === result.playerId);
  const moves = result.rounds.flatMap(round => round.moves)
    .filter(move => move.message)
    .map(move => ({
      round: move.round,
      phase: move.phase,
      decisionType: move.decisionType,
      message: move.message,
    }));
  if (moves.length === 0) return null;
  return {
    score: ownTotal,
    projectedMargin: result.projectedMargin,
    scenarioKey: `${snapshot.gameId}:${snapshot.roundNumber}:${snapshot.currentPhase}`,
    cityId: target?.cityId,
    tags: inferReferenceTags(result),
    moves,
  };
}

function inferReferenceTags(result: LiveSolverResult): string[] {
  const tags = new Set<string>();
  for (const round of result.rounds) {
    for (const move of round.moves) {
      const message = move.message;
      if (!message) continue;
      if (message.type === 'RESOLVE_ACTION') {
        tags.add(message.actionType.toLowerCase());
        if (message.choices.targetCardId) tags.add(`card:${message.choices.targetCardId}`);
        if (message.choices.explorationTokenId) tags.add('token:explore');
        if (message.choices.buyMinorKnowledge) tags.add('token:minor-buy');
      }
      if (message.type === 'PROGRESS_TRACK') {
        tags.add('progress');
        tags.add(`progress:${message.advancement.track.toLowerCase()}`);
      }
      if (message.type === 'CLAIM_ACHIEVEMENT') {
        tags.add('achievement');
        tags.add(`achievement:${message.trackChoice.toLowerCase()}`);
      }
      if (message.type === 'ACTIVATE_DEV') tags.add(`dev:${message.devId}`);
    }
  }
  return Array.from(tags).slice(0, 32);
}

async function learnReferenceLineFromResult(snapshot: LiveSolverSnapshot, result: LiveSolverResult): Promise<void> {
  const line = resultToReferenceLine(snapshot, result);
  if (!line) return;
  await putRecord(STORE_LINES, {
    key: referenceLineKey(line),
    value: line,
    score: line.score,
    updatedAt: Date.now(),
  });
  referenceLinesPromise = null;
  await trimStore(STORE_LINES, MAX_LEARNED_LINES);
}

function queuePersistence(snapshot: LiveSolverSnapshot, cacheKey: string, result: LiveSolverResult): void {
  const quality = resultQuality(result);
  if (quality <= (persistedQuality.get(cacheKey) ?? -Infinity)) return;
  if (persistedQuality.size >= 96) persistedQuality.delete(persistedQuality.keys().next().value!);
  persistedQuality.set(cacheKey, quality);
  persistenceChain = persistenceChain
    .then(async () => {
      await saveCachedResult(cacheKey, result);
      await learnReferenceLineFromResult(snapshot, result);
    })
    .catch(() => {
      // Persistence is an accelerator only; search results remain usable without it.
      if (persistedQuality.get(cacheKey) === quality) persistedQuality.delete(cacheKey);
    });
}

async function flushPersistence(maxWaitMs = 250): Promise<void> {
  await Promise.race([persistenceChain, sleep(maxWaitMs)]);
}

function yieldToBrowser(): Promise<void> {
  return sleep(16);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function loadLearnedReferenceLines(): Promise<LiveSolverReferenceLine[]> {
  const records = await getAllRecords<{ value?: unknown; score?: number; updatedAt?: number }>(STORE_LINES);
  return sanitizeReferenceLines(records
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .map(record => record.value));
}

async function saveCachedResult(key: string, result: LiveSolverResult): Promise<void> {
  if (result.status !== 'READY') return;
  await putRecord(STORE_RESULTS, {
    key,
    value: result,
    score: resultQuality(result),
    updatedAt: Date.now(),
  });
  await trimStore(STORE_RESULTS, 80);
}

async function loadCachedResult(key: string, requestId: string): Promise<LiveSolverResult | null> {
  const record = await getRecord<{ value?: unknown }>(STORE_RESULTS, key);
  const result = sanitizeCachedResult(record?.value, requestId);
  return result;
}

function sanitizeCachedResult(value: unknown, requestId: string): LiveSolverResult | null {
  if (!value || typeof value !== 'object') return null;
  const result = value as LiveSolverResult;
  if (result.status !== 'READY' || !Array.isArray(result.rounds) || !Array.isArray(result.projections)) return null;
  if (!Number.isFinite(resultQuality(result))) return null;
  return {
    ...result,
    requestId,
    generatedAt: Date.now(),
    message: 'Restored the best cached line for this exact state while search resumes.',
    proofReason: result.proofReason.includes('Persistent cache:')
      ? result.proofReason
      : `${result.proofReason} Persistent cache: exact state hit.`,
  };
}

function referenceLineKey(line: LiveSolverReferenceLine): string {
  return stableJson({
    cityId: line.cityId,
    score: line.score,
    moves: line.moves.map(move => move.message),
  });
}

function mergeReferenceLines(lines: LiveSolverReferenceLine[]): LiveSolverReferenceLine[] {
  return sanitizeReferenceLines(lines)
    .sort((a, b) => b.score - a.score);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function openSolverDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of [STORE_RESULTS, STORE_LINES]) {
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: 'key' });
          store.createIndex('score', 'score');
          store.createIndex('updatedAt', 'updatedAt');
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putRecord(storeName: string, record: Record<string, unknown>): Promise<void> {
  try {
    const db = await openSolverDb();
    await transactionDone(db, storeName, store => {
      store.put(record);
    });
    db.close();
  } catch {
    // IndexedDB may be unavailable in some embedded browser contexts; the solver still works without persistence.
  }
}

async function getRecord<T>(storeName: string, key: string): Promise<T | null> {
  try {
    const db = await openSolverDb();
    const value = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return value;
  } catch {
    return null;
  }
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  try {
    const db = await openSolverDb();
    const values = await new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return values;
  } catch {
    return [];
  }
}

async function trimStore(storeName: string, keep: number): Promise<void> {
  try {
    const db = await openSolverDb();
    const records = await new Promise<Array<{ key: string; score?: number; updatedAt?: number }>>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as Array<{ key: string; score?: number; updatedAt?: number }>);
      request.onerror = () => reject(request.error);
    });
    const stale = records
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(keep);
    if (stale.length > 0) {
      await transactionDone(db, storeName, store => {
        for (const record of stale) store.delete(record.key);
      });
    }
    db.close();
  } catch {
    // Best-effort cache cleanup.
  }
}

function transactionDone(
  db: IDBDatabase,
  storeName: string,
  apply: (store: IDBObjectStore) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    apply(tx.objectStore(storeName));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function errorResult(requestId: string, playerId: string, error: unknown): LiveSolverResult {
  const message = error instanceof Error ? error.message : 'Live solver failed in the browser worker.';
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
    computeMs: 0,
    horizon: 'PARTIAL',
    proofStatus: 'UNPROVEN',
    proofNodes: 0,
    proofReason: message,
    opponentModel: 'LIGHTWEIGHT_ACHIEVEMENT_EVENT_FIELD',
  };
}
