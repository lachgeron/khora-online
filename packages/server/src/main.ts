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
import { LobbyManager, generatePlayerId } from './lobby';
import { RestApiHandler } from './api/rest-api';
import { WebSocketGateway } from './api/websocket-gateway';
import { GameEngine } from './game-engine';
import { handleDisconnect, handleReconnect } from './disconnection';

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
// Track active assign-dice timers per game
const assignDiceTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Track active display-phase timers per game
const displayTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * After each state update, check if we need to start or cancel
 * the 5-second PHASE_DISPLAY timer (for Omen, Taxation, Glory phases).
 */
function manageDisplayTimer(gameId: string, state: GameState): void {
  const pendingDisplay = state.pendingDecisions.filter(d => d.decisionType === 'PHASE_DISPLAY');

  if (pendingDisplay.length === 0) {
    const existing = displayTimers.get(gameId);
    if (existing) {
      clearTimeout(existing);
      displayTimers.delete(gameId);
    }
    return;
  }

  if (displayTimers.has(gameId)) return;

  const timeoutAt = pendingDisplay[0].timeoutAt;
  const remaining = Math.max(0, timeoutAt - Date.now());
  console.log(`[TIMER] Starting ${remaining}ms display timer for game ${gameId} (phase: ${state.currentPhase})`);

  const timerId = setTimeout(() => {
    displayTimers.delete(gameId);
    let currentState = games.get(gameId);
    const gameEngine = engines.get(gameId);
    if (!currentState || !gameEngine) return;

    if (currentState.pendingDecisions.some(d => d.decisionType === 'PHASE_DISPLAY')) {
      console.log(`[TIMER] Display timer expired for game ${gameId} — advancing from ${currentState.currentPhase}`);
      currentState = gameEngine.handleTimeout(currentState, '__display__');
      games.set(gameId, currentState);
      wsGateway.broadcastToGame(gameId, currentState);

      // Send dedicated GAME_OVER message when game ends via timer
      if (currentState.currentPhase === 'GAME_OVER' && currentState.finalScores) {
        const gameConns = wsGateway.getConnectedPlayers(gameId);
        for (const pid of gameConns) {
          wsGateway.sendToPlayer(gameId, pid, {
            type: 'GAME_OVER',
            finalScores: currentState.finalScores,
          });
        }
      }

      manageDisplayTimer(gameId, currentState);
      manageAssignDiceTimer(gameId, currentState);
    }
  }, remaining);

  displayTimers.set(gameId, timerId);
}

/**
 * After each state update, check if we need to start or cancel
 * the 60-second ASSIGN_DICE timer.
 */
function manageAssignDiceTimer(gameId: string, state: GameState): void {
  const pendingAssign = state.pendingDecisions.filter(d => d.decisionType === 'ASSIGN_DICE');

  if (pendingAssign.length === 0) {
    const existing = assignDiceTimers.get(gameId);
    if (existing) {
      console.log(`[TIMER] Cancelling assign-dice timer for game ${gameId} — all players assigned`);
      clearTimeout(existing);
      assignDiceTimers.delete(gameId);
    }
    return;
  }

  if (assignDiceTimers.has(gameId)) return;

  const timeoutAt = pendingAssign[0].timeoutAt;
  const remaining = Math.max(0, timeoutAt - Date.now());
  console.log(`[TIMER] Starting 60s assign-dice timer for game ${gameId} (${remaining}ms remaining, ${pendingAssign.length} players pending)`);

  const timerId = setTimeout(() => {
    assignDiceTimers.delete(gameId);
    let currentState = games.get(gameId);
    const gameEngine = engines.get(gameId);
    if (!currentState || !gameEngine) {
      console.log(`[TIMER] Timer fired but game ${gameId} not found`);
      return;
    }

    if (currentState.currentPhase !== 'DICE') {
      console.log(`[TIMER] Timer fired but game ${gameId} is in phase ${currentState.currentPhase}, skipping`);
      return;
    }

    const stillPending = currentState.pendingDecisions.filter(d => d.decisionType === 'ASSIGN_DICE');
    console.log(`[TIMER] Timer expired for game ${gameId} — auto-resolving ${stillPending.length} players`);
    for (const decision of stillPending) {
      console.log(`[TIMER] Auto-resolving player ${decision.playerId}`);
      currentState = gameEngine.handleTimeout(currentState, decision.playerId);
    }

    games.set(gameId, currentState);
    wsGateway.broadcastToGame(gameId, currentState);
  }, remaining);

  assignDiceTimers.set(gameId, timerId);
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

// POST /api/lobbies/:lobbyId/start — start game
app.post('/api/lobbies/:lobbyId/start', (req, res) => {
  const { lobbyId } = req.params;
  const { requestingPlayerId } = req.body;
  const startResult = restApi.startGame(lobbyId, requestingPlayerId);
  if (!startResult.ok) return res.status(400).json(startResult.error);

  const players = startResult.value.players;
  const cities = makeDefaultCityCards(players.length + 2);

  const gameEngine = new GameEngine();
  const state = gameEngine.initializeGame(players, cities, makeDefaultEventDeck(), makeDefaultPoliticsDeck(), makeDefaultAchievements(), makeDefaultCentralBoardTokens());

  games.set(state.gameId, state);
  engines.set(state.gameId, gameEngine);
  lobbyGameIds.set(lobbyId, state.gameId);

  manageAssignDiceTimer(state.gameId, state);
  manageDisplayTimer(state.gameId, state);
  res.json({ gameId: state.gameId, players });
});

// POST /api/games/:gameId/take-seat — take a disconnected player's seat
app.post('/api/games/:gameId/take-seat', (req, res) => {
  const { gameId } = req.params;
  const { playerName } = req.body;

  if (!playerName || playerName.trim().length === 0) {
    return res.status(400).json({ code: 'INVALID_REQUEST', message: 'playerName is required.' });
  }

  const state = games.get(gameId);
  if (!state) {
    return res.status(404).json({ code: 'GAME_NOT_FOUND', message: 'Game not found.' });
  }

  // Find a disconnected player whose seat can be taken
  const disconnectedIds = new Set(state.disconnectedPlayers.keys());
  const openPlayer = state.players.find(p => disconnectedIds.has(p.playerId) && !p.isConnected);

  if (!openPlayer) {
    return res.status(400).json({ code: 'NO_OPEN_SEATS', message: 'No open seats available in this game.' });
  }

  // Reconnect the player with the new name
  let updatedState = handleReconnect(state, openPlayer.playerId);
  updatedState = {
    ...updatedState,
    players: updatedState.players.map(p =>
      p.playerId === openPlayer.playerId ? { ...p, playerName: playerName.trim() } : p,
    ),
  };
  games.set(gameId, updatedState);

  console.log(`[SEAT] Player "${playerName}" took seat of "${openPlayer.playerName}" (${openPlayer.playerId}) in game ${gameId}`);

  // Broadcast updated state to existing players
  wsGateway.broadcastToGame(gameId, updatedState);

  res.json({ gameId, playerId: openPlayer.playerId });
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
  res.json(makeDefaultCityCards(7));
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
  manageDisplayTimer(gameId, state);

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

      if (message.type === 'ACTIVATE_DEV') {
        const updatedState = activateDev(currentState, playerId, message.devId);
        if (updatedState !== currentState) {
          games.set(gameId, { ...updatedState, updatedAt: Date.now() });
          wsGateway.broadcastToGame(gameId, updatedState);
        }
        return;
      }

      const result = gameEngine.handlePlayerDecision(currentState, playerId, message);
      if (result.ok) {
        games.set(gameId, result.value);
        wsGateway.broadcastToGame(gameId, result.value);
        manageAssignDiceTimer(gameId, result.value);
        manageDisplayTimer(gameId, result.value);

        // Send dedicated GAME_OVER message when game ends
        if (result.value.currentPhase === 'GAME_OVER' && result.value.finalScores) {
          const gameConns = wsGateway.getConnectedPlayers(gameId);
          for (const pid of gameConns) {
            wsGateway.sendToPlayer(gameId, pid, {
              type: 'GAME_OVER',
              finalScores: result.value.finalScores,
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

server.listen(PORT, () => {
  console.log(`Khora Online server running on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});
