import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@khora/shared';
import { GameServer } from '../integration';
import { WebSocketGateway } from './websocket-gateway';

describe('WebSocketGateway', () => {
  it('keeps earlier tabs subscribed when the same player opens another connection', () => {
    const server = new GameServer();
    const state = server.createAndStartGame(['LJC', 'LachG']);
    const playerId = state.players[0].playerId;
    const firstMessages: ServerMessage[] = [];
    const secondMessages: ServerMessage[] = [];
    const gateway = new WebSocketGateway();

    const firstConnectionId = gateway.addConnection(state.gameId, playerId, message => {
      firstMessages.push(message);
    });
    const secondConnectionId = gateway.addConnection(state.gameId, playerId, message => {
      secondMessages.push(message);
    });

    gateway.broadcastToGame(state.gameId, state);

    expect(firstMessages).toHaveLength(1);
    expect(secondMessages).toHaveLength(1);
    expect(gateway.getConnectionCount(state.gameId)).toBe(1);
    expect(gateway.isConnected(state.gameId, playerId)).toBe(true);

    const stillConnected = gateway.removeConnection(state.gameId, playerId, secondConnectionId);
    gateway.broadcastToGame(state.gameId, state);

    expect(stillConnected).toBe(true);
    expect(firstMessages).toHaveLength(2);
    expect(secondMessages).toHaveLength(1);
    expect(gateway.isConnected(state.gameId, playerId)).toBe(true);

    expect(gateway.removeConnection(state.gameId, playerId, firstConnectionId)).toBe(false);
    expect(gateway.isConnected(state.gameId, playerId)).toBe(false);
  });
});
