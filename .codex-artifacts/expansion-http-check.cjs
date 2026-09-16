const assert = require('node:assert/strict');
const WebSocket = require('ws');
const base = 'http://localhost:3001/api';
async function request(path, method = 'GET', body) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
}
async function check(enabled, draftMode) {
  const { data: lobby } = await request('/lobbies', 'POST', { hostPlayerName: 'Expansion test host' });
  const path = `/lobbies/${lobby.lobbyId}`;
  assert.equal((await request(path)).data.includeExpansionCards, false);
  const { data: guest } = await request(path + '/join', 'POST', { playerName: 'Expansion test guest' });
  assert.equal((await request(path + '/settings', 'PATCH', { includeExpansionCards: true, requestingPlayerId: guest.playerId })).status, 403);
  assert.equal((await request(path + '/settings', 'PATCH', { includeExpansionCards: 'true', requestingPlayerId: lobby.hostPlayerId })).status, 400);
  assert.equal((await request(path + '/settings', 'PATCH', { includeExpansionCards: enabled, draftMode, recordStats: false, requestingPlayerId: lobby.hostPlayerId })).status, 200);
  assert.equal((await request(path)).data.includeExpansionCards, enabled);
  const { data: started } = await request(path + '/start', 'POST', { requestingPlayerId: lobby.hostPlayerId });
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:3001/ws?gameId=${started.gameId}&playerId=${lobby.hostPlayerId}`);
    const timer = setTimeout(() => { socket.close(); reject(new Error('No game state')); }, 5000);
    socket.on('error', reject);
    socket.on('message', raw => {
      const message = JSON.parse(String(raw));
      if (message.type !== 'GAME_STATE_UPDATE') return;
      try {
        assert.equal(message.state.draftMode, draftMode);
        clearTimeout(timer); socket.close(); resolve();
      } catch (error) { clearTimeout(timer); socket.close(); reject(error); }
    });
  });
  assert.equal((await request(path + '/settings', 'PATCH', { includeExpansionCards: !enabled, requestingPlayerId: lobby.hostPlayerId })).status, 400);
  console.log(`PASS: ${draftMode}, expansion ${enabled ? 'on' : 'off'}, host-only setting, frozen after start`);
}
(async () => { for (const mode of ['STANDARD', 'PICK_BAN']) for (const enabled of [false, true]) await check(enabled, mode); })().catch(error => { console.error(error); process.exitCode = 1; });
