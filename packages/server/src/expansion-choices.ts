import type { ExpansionChoice, GameState } from '@khora/shared';

export function queueExpansionChoice(state: GameState, choice: ExpansionChoice): GameState {
  return { ...state, expansionChoices: [...(state.expansionChoices ?? []), choice] };
}

export function hasExpansionChoices(state: GameState): boolean {
  return Boolean(state.expansionChoices?.length || state.players.some(p => (p.pendingGloryGains ?? 0) > 0));
}

/** Suspend ordinary decisions and their timers while a card's effect is resolved. */
export function prepareExpansionChoices(state: GameState): GameState {
  let result = state;
  const gloryChoices: ExpansionChoice[] = [];
  for (const player of state.players) {
    if ((player.pendingGloryGains ?? 0) > 0) {
      gloryChoices.push({ playerId: player.playerId, cardId: 'frescoes-by-polygnotus', kind: 'GLORY', amount: player.pendingGloryGains });
      result = { ...result, players: result.players.map(p => p.playerId === player.playerId ? { ...p, pendingGloryGains: 0 } : p) };
    }
  }
  // Settle gained Glory before follow-up effects can spend or reset it (e.g. Architect → Helots).
  if (gloryChoices.length) result = { ...result, expansionChoices: [...gloryChoices, ...(result.expansionChoices ?? [])] };
  const choice = result.expansionChoices?.[0];
  if (!choice) return result;
  return {
    ...result,
    suspendedDecisions: result.suspendedDecisions ?? result.pendingDecisions.map(d => ({ ...d, timeoutAt: Math.max(0, d.timeoutAt - Date.now()) })),
    pendingDecisions: [{ playerId: choice.playerId, decisionType: 'EXPANSION_CHOICE', timeoutAt: Date.now() + 60_000, options: null }],
  };
}

export function restoreExpansionDecisions(state: GameState): GameState {
  return { ...state, suspendedDecisions: undefined, pendingDecisions: (state.suspendedDecisions ?? []).map(d => ({ ...d, timeoutAt: Date.now() + d.timeoutAt })) };
}
