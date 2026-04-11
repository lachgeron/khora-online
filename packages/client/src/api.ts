/**
 * HTTP API client for Khora Online.
 */

const BASE_URL = '/api';

/** Fetch all available games (open lobbies + in-progress with open seats). */
export async function listGames() {
  const res = await fetch(`${BASE_URL}/games`);
  return res.json();
}

/** Create a new lobby. */
export async function createLobby(hostPlayerName: string) {
  const res = await fetch(`${BASE_URL}/lobbies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostPlayerName }),
  });
  return res.json();
}

/** Join a lobby by its ID. */
export async function joinLobby(lobbyId: string, playerName: string) {
  const res = await fetch(`${BASE_URL}/lobbies/${lobbyId}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName }),
  });
  return res.json();
}

/** Start a game from a lobby. */
export async function startGame(lobbyId: string, requestingPlayerId: string) {
  const res = await fetch(`${BASE_URL}/lobbies/${lobbyId}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestingPlayerId }),
  });
  return res.json();
}

/** Take a disconnected player's seat in an in-progress game. */
export async function takeSeat(gameId: string, playerName: string) {
  const res = await fetch(`${BASE_URL}/games/${gameId}/take-seat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName }),
  });
  return res.json();
}

export async function getCities() {
  const res = await fetch(`${BASE_URL}/cities`);
  return res.json();
}

/** Update lobby settings (e.g. recordStats toggle, draftMode). */
export async function updateLobbySettings(lobbyId: string, settings: { recordStats?: boolean; draftMode?: string }) {
  const res = await fetch(`${BASE_URL}/lobbies/${lobbyId}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return res.json();
}

/** Fetch player stats. */
export async function getStats() {
  const res = await fetch(`${BASE_URL}/stats`);
  return res.json();
}
