/**
 * Khora Online — HTTP + WebSocket server entry point.
 *
 * Run with: npx tsx packages/server/src/main.ts
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMessage, ServerMessage, GameState } from '@khora/shared';
import { activateDev } from './city-dev-handlers';
import { RANDOM_EVENTS, STARTING_EVENT, FINAL_EVENT } from './game-data';
import { LobbyManager, generatePlayerId } from './lobby';
import { RestApiHandler } from './api/rest-api';
import { WebSocketGateway } from './api/websocket-gateway';
import { GameEngine } from './game-engine';
import { handleDisconnect, handleReconnect } from './disconnection';
import { loadStats, recordGame } from './stats';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

// --- Singletons ---
const lobbyManager = new LobbyManager();
const restApi = new RestApiHandler(lobbyManager);
const wsGateway = new WebSocketGateway();

// Active games store
const games = new Map<string, GameState>();
// Map gameId → engine instance (each game needs its own state machine)
const engines = new Map<string, GameEngine>();
// Map lobbyId → gameId (so non-host players can discover the game)
const lobbyGameIds = new Map<string, string>();
// Track active decision timers per game
const gameTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Track per-player time bank usage start times: key = `${gameId}:${playerId}`
const timeBankUsage = new Map<string, number>();
// Track which games have already had stats recorded (prevent double-recording)
const statsRecorded = new Set<string>();
// Games where stats recording was disabled in the lobby
const unrecordedGames = new Set<string>();

/** Record stats for a finished game (idempotent per gameId). */
function recordGameStats(gameId: string, state: GameState): void {
  if (statsRecorded.has(gameId)) return;
  if (unrecordedGames.has(gameId)) return;
  if (!state.finalScores) return;
  statsRecorded.add(gameId);

  // Build city name lookup from the master city card list
  const allCities = makeDefaultCityCards();
  const cityById = new Map(allCities.map(c => [c.id, c.name]));
  const cityMap: Record<string, string> = {};
  for (const p of state.players) {
    cityMap[p.playerId] = cityById.get(p.cityId) ?? p.cityId ?? 'Unknown';
  }
  recordGame(state.finalScores, state.players.length, cityMap);
}

/**
 * Generic timer manager: after each state update, start a timer for the
 * earliest pending decision timeout. When it fires, auto-resolve all
 * expired decisions.
 */
function manageGameTimer(gameId: string, state: GameState): void {
  // Cancel existing timer
  const existing = gameTimers.get(gameId);
  if (existing) {
    clearTimeout(existing);
    gameTimers.delete(gameId);
  }

  if (state.pendingDecisions.length === 0) return;
  if (state.currentPhase === 'GAME_OVER') return;

  // Find the earliest timeout
  const earliest = Math.min(...state.pendingDecisions.map(d => d.timeoutAt));
  const remaining = Math.max(1000, earliest - Date.now()); // minimum 1s to avoid rapid cascading

  console.log(`[TIMER] Setting timer for game ${gameId}: ${remaining}ms (phase: ${state.currentPhase}, decisions: ${state.pendingDecisions.map(d => `${d.decisionType}@${d.playerId}`).join(', ')})`);

  const timerId = setTimeout(() => {
    gameTimers.delete(gameId);
    let currentState = games.get(gameId);
    const gameEngine = engines.get(gameId);
    if (!currentState || !gameEngine) return;

    const now = Date.now();

    // First pass: extend ALL time-bank-eligible expired decisions simultaneously.
    // This handles simultaneous decisions (e.g. ASSIGN_DICE for all players)
    // without staggering each player's time bank start by 1 second.
    const timeBankPlayers: string[] = [];
    for (const d of currentState.pendingDecisions) {
      if (d.timeoutAt <= now && d.decisionType !== 'PHASE_DISPLAY' && !d.usingTimeBank) {
        const player = currentState.players.find(p => p.playerId === d.playerId);
        if (player && player.timeBankMs > 0) {
          timeBankPlayers.push(d.playerId);
          timeBankUsage.set(`${gameId}:${d.playerId}`, now);
        }
      }
    }

    if (timeBankPlayers.length > 0 && currentState) {
      const tbSet = new Set(timeBankPlayers);
      const players = currentState.players;
      console.log(`[TIMER] Normal timer expired for ${timeBankPlayers.join(', ')} in game ${gameId}, switching to time bank`);
      currentState = {
        ...currentState,
        pendingDecisions: currentState.pendingDecisions.map(d => {
          if (d.timeoutAt <= now && tbSet.has(d.playerId) && d.decisionType !== 'PHASE_DISPLAY' && !d.usingTimeBank) {
            const player = players.find(p => p.playerId === d.playerId);
            return { ...d, timeoutAt: now + (player?.timeBankMs ?? 0), usingTimeBank: true };
          }
          return d;
        }),
      };
    }

    // Second pass: auto-resolve remaining expired decisions one at a time
    let resolved = true;
    while (resolved) {
      resolved = false;
      const expired = currentState.pendingDecisions.find(d => d.timeoutAt <= now);
      if (!expired) break;

      // If time bank expired, zero it out
      if (expired.usingTimeBank) {
        console.log(`[TIMER] Time bank exhausted for ${expired.playerId} in game ${gameId}; flagging player`);
        timeBankUsage.delete(`${gameId}:${expired.playerId}`);
        currentState = gameEngine.handleFlag(currentState, expired.playerId);
        resolved = true;
        continue;
      }

      if (expired.decisionType !== 'PHASE_DISPLAY') {
        const player = currentState.players.find(p => p.playerId === expired.playerId);
        if (player && player.timeBankMs <= 0) {
          console.log(`[TIMER] No time bank remaining for ${expired.playerId} in game ${gameId}; flagging player`);
          currentState = gameEngine.handleFlag(currentState, expired.playerId);
          resolved = true;
          continue;
        }
      }

      const pid = expired.decisionType === 'PHASE_DISPLAY' ? '__display__' : expired.playerId;
      console.log(`[TIMER] Auto-resolving ${expired.decisionType} for ${pid} in game ${gameId}`);
      currentState = gameEngine.handleTimeout(currentState, pid);
      resolved = true;
    }

    games.set(gameId, currentState);
    wsGateway.broadcastToGame(gameId, currentState);

    // Send dedicated GAME_OVER message when game ends via timer
    if (currentState.currentPhase === 'GAME_OVER' && currentState.finalScores) {
      recordGameStats(gameId, currentState);
      const gameConns = wsGateway.getConnectedPlayers(gameId);
      for (const pid of gameConns) {
        wsGateway.sendToPlayer(gameId, pid, {
          type: 'GAME_OVER',
          finalScores: currentState.finalScores,
        });
      }
    }

    // Continue managing timers for remaining decisions
    manageGameTimer(gameId, currentState);
  }, remaining);

  gameTimers.set(gameId, timerId);
}

// --- Game data ---
import {
  makeDefaultCityCards,
  makeDefaultEventDeck,
  makeDefaultPoliticsDeck,
  makeDefaultAchievements,
  makeDefaultCentralBoardTokens,
} from './integration';

// --- Express app ---
const app = express();
app.use(cors());
app.use(express.json());

// GET /api/games — list all available games (lobbies + in-progress with open seats)
app.get('/api/games', (_req, res) => {
  res.json(restApi.listGames(games, lobbyGameIds));
});

// POST /api/lobbies — create lobby
app.post('/api/lobbies', (req, res) => {
  const { hostPlayerName } = req.body;
  const result = restApi.createLobby(hostPlayerName);
  if (!result.ok) return res.status(400).json(result.error);
  res.json(result.value);
});

// POST /api/lobbies/:lobbyId/join — join lobby by ID
app.post('/api/lobbies/:lobbyId/join', (req, res) => {
  const { lobbyId } = req.params;
  const { playerName } = req.body;
  const result = restApi.joinLobby(lobbyId, playerName);
  if (!result.ok) return res.status(400).json(result.error);
  res.json(result.value);
});

// PATCH /api/lobbies/:lobbyId/settings — update lobby settings (e.g. recordStats)
app.patch('/api/lobbies/:lobbyId/settings', (req, res) => {
  const lobby = lobbyManager.getLobby(req.params.lobbyId);
  if (!lobby) return res.status(404).json({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
  if (lobby.started) return res.status(400).json({ code: 'LOBBY_ALREADY_STARTED', message: 'Lobby already started' });
  if (typeof req.body.recordStats === 'boolean') {
    lobby.recordStats = req.body.recordStats;
  }
  if (req.body.draftMode === 'STANDARD' || req.body.draftMode === 'PICK_BAN') {
    lobby.draftMode = req.body.draftMode;
  }
  res.json({ recordStats: lobby.recordStats, draftMode: lobby.draftMode });
});

// POST /api/lobbies/:lobbyId/start — start game
app.post('/api/lobbies/:lobbyId/start', (req, res) => {
  const { lobbyId } = req.params;
  const { requestingPlayerId } = req.body;
  const startResult = restApi.startGame(lobbyId, requestingPlayerId);
  if (!startResult.ok) return res.status(400).json(startResult.error);

  const players = startResult.value.players;
  const cities = makeDefaultCityCards();
  const lobby = lobbyManager.getLobby(lobbyId);
  const draftMode = lobby?.draftMode ?? 'STANDARD';

  const gameEngine = new GameEngine(draftMode);
  const state = gameEngine.initializeGame(players, cities, makeDefaultEventDeck(), makeDefaultPoliticsDeck(), makeDefaultAchievements(), makeDefaultCentralBoardTokens(), draftMode);

  games.set(state.gameId, state);
  engines.set(state.gameId, gameEngine);
  lobbyGameIds.set(lobbyId, state.gameId);

  // Check if stats recording was disabled for this lobby
  if (lobby && !lobby.recordStats) {
    unrecordedGames.add(state.gameId);
  }

  manageGameTimer(state.gameId, state);
  res.json({ gameId: state.gameId, players });
});

// GET /api/lobbies/:lobbyId — get lobby info
app.get('/api/lobbies/:lobbyId', (req, res) => {
  const lobby = lobbyManager.getLobby(req.params.lobbyId);
  if (!lobby) return res.status(404).json({ code: 'LOBBY_NOT_FOUND', message: 'Lobby not found' });
  const gameId = lobbyGameIds.get(req.params.lobbyId) ?? null;
  res.json({ ...lobby, gameId });
});

// GET /api/cities — available city cards
app.get('/api/cities', (_req, res) => {
  res.json(makeDefaultCityCards());
});

// GET /api/stats — player stats
app.get('/api/stats', (_req, res) => {
  res.json(loadStats());
});

// --- HTTP + WebSocket server ---
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Track raw WS connections: ws → { gameId, playerId }
const wsClients = new Map<WebSocket, { gameId: string; playerId: string }>();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '', `http://localhost:${PORT}`);
  const gameId = url.searchParams.get('gameId');
  const playerId = url.searchParams.get('playerId');

  if (!gameId || !playerId) {
    ws.close(4000, 'Missing gameId or playerId query params');
    return;
  }

  if (!games.has(gameId)) {
    ws.close(4001, 'Game not found');
    return;
  }

  console.log(`[WS] Player ${playerId} connected to game ${gameId}`);
  wsClients.set(ws, { gameId, playerId });

  // Register in gateway
  wsGateway.addConnection(gameId, playerId, (msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  });

  // Handle reconnection: if this player was disconnected, mark them reconnected
  let state = games.get(gameId)!;
  if (state.disconnectedPlayers.has(playerId)) {
    state = handleReconnect(state, playerId);
    games.set(gameId, state);
    console.log(`[WS] Player ${playerId} reconnected to game ${gameId}`);
  }

  // Send initial state
  wsGateway.broadcastToGame(gameId, state);
  manageGameTimer(gameId, state);

  ws.on('message', (data) => {
    try {
      const message: ClientMessage = JSON.parse(data.toString());
      const currentState = games.get(gameId);
      if (!currentState) return;

      const gameEngine = engines.get(gameId);
      if (!gameEngine) return;

      if (message.type === 'HEARTBEAT') {
        wsGateway.handleMessage(gameId, playerId, message);
        return;
      }

      if (message.type === 'ADMIN_REQUEST_DECK') {
        wsGateway.sendToPlayer(gameId, playerId, {
          type: 'ADMIN_DECK_RESPONSE',
          deckCards: currentState.politicsDeck,
        });
        return;
      }

      if (message.type === 'ADMIN_SWAP_CARD') {
        const player = currentState.players.find(p => p.playerId === playerId);
        if (!player) return;
        const handIdx = player.handCards.findIndex(c => c.id === message.handCardId);
        const deckIdx = currentState.politicsDeck.findIndex(c => c.id === message.deckCardId);
        if (handIdx === -1 || deckIdx === -1) return;

        // Guard: the two cards must be different (no self-swap)
        if (message.handCardId === message.deckCardId) return;

        const removedFromHand = player.handCards[handIdx];
        const removedFromDeck = currentState.politicsDeck[deckIdx];
        const newHandCards = [...player.handCards];
        newHandCards[handIdx] = removedFromDeck;
        const newDeck = [...currentState.politicsDeck];
        newDeck[deckIdx] = removedFromHand;

        // Deduplicate hands: remove any card ID that appears more than
        // once in the swapping player's hand (guards against prior state
        // corruption where a card exists in both deck and hand).
        const seenInHand = new Set<string>();
        const deduplicatedHand = newHandCards.filter(c => {
          if (seenInHand.has(c.id)) {
            console.warn(`[ADMIN_SWAP] Removing duplicate card "${c.id}" from hand`);
            return false;
          }
          seenInHand.add(c.id);
          return true;
        });

        // Deduplicate: collect every card ID across all players' hands,
        // played cards, draft packs, and drafted selections. If a card
        // appears more than once, remove extras from the deck.
        const allCardIds = new Set<string>();
        const updatedPlayers = currentState.players.map(p => {
          const hand = p.playerId === playerId ? deduplicatedHand : [...p.handCards];
          for (const c of hand) allCardIds.add(c.id);
          for (const c of p.playedCards) allCardIds.add(c.id);
          return p.playerId === playerId ? { ...p, handCards: hand } : p;
        });

        // Also account for cards in active draft state (packs + selected)
        const politicsDraft = currentState.draftState?.politicsDraft;
        if (politicsDraft) {
          for (const pack of Object.values(politicsDraft.packs)) {
            for (const c of pack) allCardIds.add(c.id);
          }
          for (const selected of Object.values(politicsDraft.selectedCards)) {
            for (const c of selected) allCardIds.add(c.id);
          }
        }

        const seenInDeck = new Set<string>();
        const deduplicatedDeck = newDeck.filter(c => {
          if (allCardIds.has(c.id) || seenInDeck.has(c.id)) {
            console.warn(`[ADMIN_SWAP] Removing duplicate card "${c.id}" from deck`);
            return false;
          }
          seenInDeck.add(c.id);
          return true;
        });

        const updatedState: typeof currentState = {
          ...currentState,
          politicsDeck: deduplicatedDeck,
          players: updatedPlayers,
          updatedAt: Date.now(),
        };
        games.set(gameId, updatedState);

        // Send updated deck BEFORE the broadcast so the admin modal
        // refreshes in the same React batch as the state update,
        // preventing a frame where stale hand data shows duplicates.
        wsGateway.sendToPlayer(gameId, playerId, {
          type: 'ADMIN_DECK_RESPONSE',
          deckCards: deduplicatedDeck,
        });
        wsGateway.broadcastToGame(gameId, updatedState);
        return;
      }

      if (message.type === 'ADMIN_REQUEST_EVENTS') {
        // Collect all event IDs currently in the deck + already revealed (currentEvent)
        const usedIds = new Set(currentState.eventDeck.map(c => c.id));
        if (currentState.currentEvent) usedIds.add(currentState.currentEvent.id);
        // Unused = random events not in the current deck or already played
        const unusedEvents = RANDOM_EVENTS.filter(c => !usedIds.has(c.id));
        wsGateway.sendToPlayer(gameId, playerId, {
          type: 'ADMIN_EVENTS_RESPONSE',
          eventCards: currentState.eventDeck,
          unusedEvents,
        });
        return;
      }

      if (message.type === 'ADMIN_REORDER_EVENTS') {
        // Build a lookup from both the current deck and the full event pool
        const allEvents = [...RANDOM_EVENTS, STARTING_EVENT, FINAL_EVENT];
        const eventById = new Map(allEvents.map(c => [c.id, c]));
        // Also include anything already in the deck (in case of custom events)
        for (const c of currentState.eventDeck) eventById.set(c.id, c);

        const newOrder: typeof currentState.eventDeck = [];
        for (const id of message.eventOrder) {
          const card = eventById.get(id);
          if (card) newOrder.push(card);
        }
        // Only apply if the deck size stays the same (swaps, not additions/removals)
        if (newOrder.length === currentState.eventDeck.length) {
          const updatedState = { ...currentState, eventDeck: newOrder, updatedAt: Date.now() };
          games.set(gameId, updatedState);
          // No broadcast needed — event deck is not visible to players until revealed
        }
        return;
      }

      if (message.type === 'ACTIVATE_DEV') {
        const updatedState = activateDev(currentState, playerId, message.devId);
        if (updatedState !== currentState) {
          games.set(gameId, { ...updatedState, updatedAt: Date.now() });
          wsGateway.broadcastToGame(gameId, updatedState);
        }
        return;
      }

      const tbKey = `${gameId}:${playerId}`;
      const tbStart = timeBankUsage.get(tbKey);
      if (tbStart) {
        const player = currentState.players.find(p => p.playerId === playerId);
        const elapsed = Date.now() - tbStart;
        if (player && elapsed >= player.timeBankMs) {
          timeBankUsage.delete(tbKey);
          const flaggedState = gameEngine.handleFlag(currentState, playerId);
          games.set(gameId, flaggedState);
          wsGateway.broadcastToGame(gameId, flaggedState);
          manageGameTimer(gameId, flaggedState);
          return;
        }
      }

      const result = gameEngine.handlePlayerDecision(currentState, playerId, message);
      if (result.ok) {
        let updatedState = result.value;

        // Deduct time bank if the player was using it
        const activeTbStart = timeBankUsage.get(tbKey);
        if (activeTbStart) {
          const elapsed = Date.now() - activeTbStart;
          timeBankUsage.delete(tbKey);
          updatedState = {
            ...updatedState,
            players: updatedState.players.map(p =>
              p.playerId === playerId ? { ...p, timeBankMs: Math.max(0, p.timeBankMs - elapsed) } : p
            ),
          };
          console.log(`[TIMER] Deducted ${elapsed}ms from time bank for ${playerId} in game ${gameId} (${updatedState.players.find(p => p.playerId === playerId)?.timeBankMs}ms remaining)`);
        }

        games.set(gameId, updatedState);
        wsGateway.broadcastToGame(gameId, updatedState);
        manageGameTimer(gameId, updatedState);

        // Send dedicated GAME_OVER message when game ends
        if (updatedState.currentPhase === 'GAME_OVER' && updatedState.finalScores) {
          recordGameStats(gameId, updatedState);
          const gameConns = wsGateway.getConnectedPlayers(gameId);
          for (const pid of gameConns) {
            wsGateway.sendToPlayer(gameId, pid, {
              type: 'GAME_OVER',
              finalScores: updatedState.finalScores,
            });
          }
        }
      } else {
        wsGateway.sendToPlayer(gameId, playerId, {
          type: 'ERROR', code: result.error.code, message: result.error.message,
        });
      }
    } catch (err) {
      console.error('[WS] Error handling message:', err);
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Player ${playerId} disconnected from game ${gameId}`);
    wsClients.delete(ws);
    wsGateway.removeConnection(gameId, playerId);

    // Mark player as disconnected in game state
    const currentState = games.get(gameId);
    if (currentState && currentState.currentPhase !== 'GAME_OVER') {
      const updatedState = handleDisconnect(currentState, playerId);
      games.set(gameId, updatedState);
      wsGateway.broadcastToGame(gameId, updatedState);
    }
  });
});

// Start heartbeat monitoring — detect zombie connections every 15 seconds
wsGateway.onDisconnect((gameId, playerId) => {
  console.log(`[HEARTBEAT] Player ${playerId} heartbeat expired in game ${gameId}`);
  const currentState = games.get(gameId);
  if (currentState && currentState.currentPhase !== 'GAME_OVER') {
    const updatedState = handleDisconnect(currentState, playerId);
    games.set(gameId, updatedState);
    wsGateway.broadcastToGame(gameId, updatedState);
  }
  // Also close the raw WS connection if it still exists
  for (const [ws, meta] of wsClients) {
    if (meta.gameId === gameId && meta.playerId === playerId) {
      wsClients.delete(ws);
      try { ws.close(); } catch { /* already closed */ }
      break;
    }
  }
});

setInterval(() => {
  wsGateway.checkHeartbeats();
}, 15_000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Khora Online server running on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
