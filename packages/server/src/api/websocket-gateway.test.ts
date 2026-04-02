import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ClientMessage, ServerMessage } from '@khora/shared';
import { WebSocketGateway } from './websocket-gateway';
import { makeTestPlayer, makeTestGameState } from '../test-helpers';

/** Creates a GameState stub for testing broadcasts. */
function makeStubGameState(playerIds: string[]) {
  return makeTestGameState({
    players: playerIds.map((id) =>
      makeTestPlayer({
        playerId: id,
        playerName: `Player ${id}`,
        coins: 10,
        diceRoll: [3, 4] as [number, number],
      }),
    ),
  });
}

describe('WebSocketGateway', () => {
  let gateway: WebSocketGateway;

  beforeEach(() => {
    gateway = new WebSocketGateway({ heartbeatTimeoutMs: 5000 });
  });

  describe('addConnection / removeConnection', () => {
    it('registers a player connection', () => {
      const send = vi.fn();
      gateway.addConnection('game-1', 'player-1', send);

      expect(gateway.isConnected('game-1', 'player-1')).toBe(true);
      expect(gateway.getConnectionCount('game-1')).toBe(1);
    });

    it('tracks multiple players per game', () => {
      gateway.addConnection('game-1', 'player-1', vi.fn());
      gateway.addConnection('game-1', 'player-2', vi.fn());

      expect(gateway.getConnectionCount('game-1')).toBe(2);
      expect(gateway.getConnectedPlayers('game-1')).toEqual(['player-1', 'player-2']);
    });

    it('tracks connections across different games', () => {
      gateway.addConnection('game-1', 'player-1', vi.fn());
      gateway.addConnection('game-2', 'player-2', vi.fn());

      expect(gateway.getConnectionCount('game-1')).toBe(1);
      expect(gateway.getConnectionCount('game-2')).toBe(1);
    });

    it('replaces existing connection for same player', () => {
      const send1 = vi.fn();
      const send2 = vi.fn();
      gateway.addConnection('game-1', 'player-1', send1);
      gateway.addConnection('game-1', 'player-1', send2);

      expect(gateway.getConnectionCount('game-1')).toBe(1);

      // Verify the new send function is used
      const state = makeStubGameState(['player-1']);
      gateway.broadcastToGame('game-1', state);
      expect(send1).not.toHaveBeenCalled();
      expect(send2).toHaveBeenCalledTimes(1);
    });

    it('removes a player connection', () => {
      gateway.addConnection('game-1', 'player-1', vi.fn());
      gateway.removeConnection('game-1', 'player-1');

      expect(gateway.isConnected('game-1', 'player-1')).toBe(false);
      expect(gateway.getConnectionCount('game-1')).toBe(0);
    });

    it('cleans up game entry when last connection removed', () => {
      gateway.addConnection('game-1', 'player-1', vi.fn());
      gateway.removeConnection('game-1', 'player-1');

      expect(gateway.getConnectedPlayers('game-1')).toEqual([]);
    });

    it('handles removing non-existent connection gracefully', () => {
      expect(() => gateway.removeConnection('game-1', 'player-1')).not.toThrow();
    });
  });

  describe('broadcastToGame', () => {
    it('sends filtered state to each connected player', () => {
      const send1 = vi.fn();
      const send2 = vi.fn();
      gateway.addConnection('game-1', 'p1', send1);
      gateway.addConnection('game-1', 'p2', send2);

      const state = makeStubGameState(['p1', 'p2']);
      gateway.broadcastToGame('game-1', state);

      expect(send1).toHaveBeenCalledTimes(1);
      expect(send2).toHaveBeenCalledTimes(1);

      // Each player gets a GAME_STATE_UPDATE with their own private state
      const msg1 = send1.mock.calls[0][0] as ServerMessage;
      const msg2 = send2.mock.calls[0][0] as ServerMessage;

      expect(msg1.type).toBe('GAME_STATE_UPDATE');
      expect(msg2.type).toBe('GAME_STATE_UPDATE');

      if (msg1.type === 'GAME_STATE_UPDATE') {
        // Private state should contain the player's own coins
        expect(msg1.privateState.coins).toBe(10);
        // Public state includes dice rolls but not coins
        expect(msg1.state.players[0]).toHaveProperty('diceRoll');
        expect(msg1.state.players[0]).not.toHaveProperty('coins');
      }
    });

    it('does nothing for non-existent game', () => {
      const state = makeStubGameState(['p1']);
      expect(() => gateway.broadcastToGame('no-game', state)).not.toThrow();
    });
  });

  describe('sendToPlayer', () => {
    it('sends a message to a specific player', () => {
      const send = vi.fn();
      gateway.addConnection('game-1', 'player-1', send);

      const message: ServerMessage = {
        type: 'PHASE_CHANGE',
        phase: 'DICE',
        roundNumber: 2,
      };
      gateway.sendToPlayer('game-1', 'player-1', message);

      expect(send).toHaveBeenCalledWith(message);
    });

    it('does nothing for non-existent player', () => {
      gateway.addConnection('game-1', 'player-1', vi.fn());
      expect(() =>
        gateway.sendToPlayer('game-1', 'player-2', {
          type: 'ERROR',
          code: 'TEST',
          message: 'test',
        }),
      ).not.toThrow();
    });

    it('does nothing for non-existent game', () => {
      expect(() =>
        gateway.sendToPlayer('no-game', 'player-1', {
          type: 'ERROR',
          code: 'TEST',
          message: 'test',
        }),
      ).not.toThrow();
    });
  });

  describe('handleMessage', () => {
    it('updates heartbeat timestamp on any message', () => {
      const originalNow = Date.now;
      let currentTime = 1000;
      Date.now = () => currentTime;

      gateway.addConnection('game-1', 'player-1', vi.fn());
      const before = gateway.getLastHeartbeat('game-1', 'player-1');
      expect(before).toBe(1000);

      currentTime = 2000;

      const heartbeat: ClientMessage = { type: 'HEARTBEAT' };
      gateway.handleMessage('game-1', 'player-1', heartbeat);

      const after = gateway.getLastHeartbeat('game-1', 'player-1');
      expect(after).toBe(2000);
      expect(after).toBeGreaterThan(before);

      Date.now = originalNow;
    });

    it('does not forward HEARTBEAT to message handler', () => {
      const handler = vi.fn();
      gateway.onMessage(handler);
      gateway.addConnection('game-1', 'player-1', vi.fn());

      gateway.handleMessage('game-1', 'player-1', { type: 'HEARTBEAT' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('forwards non-heartbeat messages to the message handler', () => {
      const handler = vi.fn();
      gateway.onMessage(handler);
      gateway.addConnection('game-1', 'player-1', vi.fn());

      const msg: ClientMessage = { type: 'SKIP_PHASE' };
      gateway.handleMessage('game-1', 'player-1', msg);

      expect(handler).toHaveBeenCalledWith('game-1', 'player-1', msg);
    });

    it('sends error back to player when handler returns error result', () => {
      const send = vi.fn();
      gateway.addConnection('game-1', 'player-1', send);

      gateway.onMessage(() => ({
        ok: false as const,
        error: { code: 'WRONG_PHASE' as const, message: 'Not in dice phase' },
      }));

      gateway.handleMessage('game-1', 'player-1', { type: 'SKIP_PHASE' });

      expect(send).toHaveBeenCalledWith({
        type: 'ERROR',
        code: 'WRONG_PHASE',
        message: 'Not in dice phase',
      });
    });

    it('handles missing message handler gracefully', () => {
      gateway.addConnection('game-1', 'player-1', vi.fn());
      expect(() =>
        gateway.handleMessage('game-1', 'player-1', { type: 'SKIP_PHASE' }),
      ).not.toThrow();
    });

    it('handles message from non-existent connection gracefully', () => {
      const handler = vi.fn();
      gateway.onMessage(handler);

      expect(() =>
        gateway.handleMessage('game-1', 'player-1', { type: 'SKIP_PHASE' }),
      ).not.toThrow();
      // Handler is still called even without a tracked connection
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('checkHeartbeats', () => {
    it('detects expired heartbeats and removes connections', () => {
      const send = vi.fn();
      gateway.addConnection('game-1', 'player-1', send);

      const originalNow = Date.now;
      let currentTime = Date.now();
      Date.now = () => currentTime;

      gateway.addConnection('game-1', 'player-stale', vi.fn());

      // Advance time past heartbeat timeout
      currentTime += 6000; // 6 seconds > 5 second timeout

      const expired = gateway.checkHeartbeats();

      expect(expired).toHaveLength(2); // Both connections are stale
      expect(gateway.getConnectionCount('game-1')).toBe(0);

      Date.now = originalNow;
    });

    it('calls disconnect handler for expired connections', () => {
      const disconnectHandler = vi.fn();
      gateway.onDisconnect(disconnectHandler);

      const originalNow = Date.now;
      let currentTime = Date.now();
      Date.now = () => currentTime;

      gateway.addConnection('game-1', 'player-1', vi.fn());

      currentTime += 6000;

      gateway.checkHeartbeats();

      expect(disconnectHandler).toHaveBeenCalledWith('game-1', 'player-1');

      Date.now = originalNow;
    });

    it('keeps connections with recent heartbeats', () => {
      const originalNow = Date.now;
      let currentTime = Date.now();
      Date.now = () => currentTime;

      gateway.addConnection('game-1', 'player-1', vi.fn());

      // Advance time but not past timeout
      currentTime += 2000; // 2 seconds < 5 second timeout

      const expired = gateway.checkHeartbeats();

      expect(expired).toHaveLength(0);
      expect(gateway.isConnected('game-1', 'player-1')).toBe(true);

      Date.now = originalNow;
    });

    it('returns empty array when no connections exist', () => {
      const expired = gateway.checkHeartbeats();
      expect(expired).toHaveLength(0);
    });
  });

  describe('utility methods', () => {
    it('getConnectionCount returns 0 for unknown game', () => {
      expect(gateway.getConnectionCount('unknown')).toBe(0);
    });

    it('isConnected returns false for unknown game/player', () => {
      expect(gateway.isConnected('unknown', 'unknown')).toBe(false);
    });

    it('getConnectedPlayers returns empty array for unknown game', () => {
      expect(gateway.getConnectedPlayers('unknown')).toEqual([]);
    });

    it('getLastHeartbeat returns 0 for unknown connection', () => {
      expect(gateway.getLastHeartbeat('unknown', 'unknown')).toBe(0);
    });
  });
});
