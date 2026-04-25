/**
 * DicePhaseManager — handles the Dice phase (Phase C) of each round.
 *
 * Per the official rules:
 * 1. Players press a button to roll their dice (2 base, 3 if culture track >= 4)
 * 2. All players can see each other's rolls
 * 3. Lowest total becomes start player for the round
 *    (ties broken by clockwise proximity to previous start player)
 * 4. Once all players have rolled, players may spend philosophy tokens for citizens
 * 5. Assign action tiles to dice simultaneously
 * 6. If die < action number, lose citizen track levels equal to the difference
 * 7. Cannot use an action tile if insufficient citizens
 *
 * Special: "Growing Populations" event triggers here if applicable.
 */

import type { ClientMessage, GameState, Result, GameError } from '@khora/shared';
import { ACTION_NUMBERS, THIRD_DIE_CULTURE_LEVEL } from '@khora/shared';
import type { PhaseManager } from './omen-phase';
import { subtractCitizens, subtractPhilosophyTokens, addCitizens } from '../resources';
import { determineTurnOrder } from '../turn-order';
import { applyEffectToAllPlayers } from '../effects';
import { appendLogEntry } from '../game-log';

const CITIZENS_PER_PHILOSOPHY_TOKEN = 3;

export class DicePhaseManager implements PhaseManager {
  onEnter(state: GameState): GameState {
    let newState = state;

    // Apply "Growing Populations" effect if applicable
    if (newState.currentEvent?.triggerDuringDice && newState.currentEvent.immediateEffect) {
      newState = applyEffectToAllPlayers(newState, newState.currentEvent.immediateEffect);
    }

    // Clear dice rolls and action slots for all players
    const updatedPlayers = newState.players.map(player => ({
      ...player,
      diceRoll: null,
      actionSlots: [null, null, null] as [null, null, null],
    }));

    newState = { ...newState, players: updatedPlayers };

    // Create ROLL_DICE pending decisions for all connected players
    const now = Date.now();
    const pendingDecisions = newState.players
      .filter(p => p.isConnected)
      .map(p => ({
        playerId: p.playerId,
        decisionType: 'ROLL_DICE' as const,
        timeoutAt: now + 10_000,
        options: null as unknown,
      }));

    return { ...newState, pendingDecisions };
  }

  handleDecision(
    state: GameState,
    playerId: string,
    decision: ClientMessage,
  ): Result<GameState, GameError> {
    if (decision.type === 'ROLL_DICE') {
      return this.handleRollDice(state, playerId);
    }
    if (decision.type === 'ASSIGN_DICE') {
      return this.handleDiceAssignment(state, playerId, decision);
    }
    if (decision.type === 'UNASSIGN_DICE') {
      return this.handleUnassignDice(state, playerId);
    }
    return {
      ok: false,
      error: { code: 'INVALID_MESSAGE', message: 'Expected ROLL_DICE, ASSIGN_DICE, or UNASSIGN_DICE message' },
    };
  }

  private handleRollDice(
    state: GameState,
    playerId: string,
  ): Result<GameState, GameError> {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };
    }

    const player = state.players[playerIndex];

    // Don't allow re-rolling
    if (player.diceRoll !== null) {
      return { ok: false, error: { code: 'ALREADY_ROLLED', message: 'Dice already rolled' } };
    }

    // Reveal the dice roll predetermined at game start.
    const hasThirdDie = player.cultureTrack >= THIRD_DIE_CULTURE_LEVEL;
    const diceCount = hasThirdDie ? 3 : 2;
    const scheduled = state.predeterminedDice[state.roundNumber]?.[playerId];
    const diceRoll = scheduled
      ? scheduled.slice(0, diceCount)
      : Array.from({ length: diceCount }, () => Math.floor(Math.random() * 6) + 1);

    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = { ...player, diceRoll };

    // Remove this player's ROLL_DICE pending decision
    let updatedDecisions = state.pendingDecisions.filter(d => d.playerId !== playerId);

    let updatedState = { ...state, players: updatedPlayers, pendingDecisions: updatedDecisions };

    // Check if all connected players have rolled
    const allRolled = updatedState.players
      .filter(p => p.isConnected)
      .every(p => p.diceRoll !== null);

    if (allRolled) {
      // Determine start player and turn order
      updatedState = determineTurnOrder(updatedState);

      // Growing Populations: players who rolled ≤4 total gain 1 scroll
      if (updatedState.currentEvent?.triggerDuringDice) {
        const updatedPlayers = updatedState.players.map(p => {
          if (!p.isConnected || !p.diceRoll) return p;
          const total = p.diceRoll.reduce((a, b) => a + b, 0);
          if (total <= 4) {
            return { ...p, philosophyTokens: p.philosophyTokens + 1 };
          }
          return p;
        });
        updatedState = { ...updatedState, players: updatedPlayers };
      }

      // Create ASSIGN_DICE pending decisions for all connected players (60s timer)
      const assignNow = Date.now();
      updatedDecisions = updatedState.players
        .filter(p => p.isConnected)
        .map(p => ({
          playerId: p.playerId,
          decisionType: 'ASSIGN_DICE' as const,
          timeoutAt: assignNow + 60_000,
          options: null as unknown,
        }));

      updatedState = { ...updatedState, pendingDecisions: updatedDecisions };
    }

    return { ok: true, value: updatedState };
  }

  private handleDiceAssignment(
    state: GameState,
    playerId: string,
    decision: Extract<ClientMessage, { type: 'ASSIGN_DICE' }>,
  ): Result<GameState, GameError> {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };
    }

    let player = state.players[playerIndex];

    // Must have rolled first
    if (!player.diceRoll) {
      return { ok: false, error: { code: 'DICE_NOT_ROLLED', message: 'Must roll dice first' } };
    }

    // Spend philosophy tokens for citizens if requested
    if (decision.philosophyTokensToSpend && decision.philosophyTokensToSpend > 0) {
      const tokensToSpend = decision.philosophyTokensToSpend;
      const philResult = subtractPhilosophyTokens(player, tokensToSpend);
      if (!philResult.ok) return { ok: false, error: philResult.error };
      player = philResult.value;
      player = addCitizens(player, tokensToSpend * CITIZENS_PER_PHILOSOPHY_TOKEN);
    }

    // Validate assignments
    const assignments = decision.assignments;
    if (!assignments || assignments.length === 0) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'No assignments provided' } };
    }

    // Ensure no duplicate actions
    const actionTypes = assignments.map(a => a.actionType);
    if (new Set(actionTypes).size !== actionTypes.length) {
      return { ok: false, error: { code: 'DUPLICATE_ACTION', message: 'Cannot assign same action twice' } };
    }

    // Validate die values match rolled dice
    const assignedDice = assignments.map(a => a.dieValue).sort();
    const rolledDice = [...(player.diceRoll ?? [])].sort();
    if (JSON.stringify(assignedDice) !== JSON.stringify(rolledDice)) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'Assigned dice do not match rolled dice' } };
    }

    // Calculate citizen costs
    let totalCitizenCost = 0;
    for (const assignment of assignments) {
      const actionNumber = ACTION_NUMBERS[assignment.actionType];
      const cost = Math.max(0, actionNumber - assignment.dieValue);
      totalCitizenCost += cost;
    }

    // Check citizen affordability
    if (player.citizenTrack < totalCitizenCost) {
      return {
        ok: false,
        error: { code: 'INSUFFICIENT_RESOURCES', message: `Need ${totalCitizenCost} citizens, have ${player.citizenTrack}` },
      };
    }

    // Deduct citizens
    if (totalCitizenCost > 0) {
      const citizenResult = subtractCitizens(player, totalCitizenCost);
      if (!citizenResult.ok) return { ok: false, error: citizenResult.error };
      player = citizenResult.value;
    }

    // Create action slots
    const actionSlots: typeof player.actionSlots = [null, null, null];
    for (let i = 0; i < assignments.length; i++) {
      const a = assignments[i];
      const actionNumber = ACTION_NUMBERS[a.actionType];
      const citizenCost = Math.max(0, actionNumber - a.dieValue);
      actionSlots[a.slotIndex] = {
        actionType: a.actionType,
        assignedDie: a.dieValue,
        resolved: false,
        citizenCost,
      };
    }

    player = { ...player, actionSlots };

    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = player;

    // Remove this player's pending decision
    const updatedDecisions = state.pendingDecisions.filter(d => d.playerId !== playerId);

    return { ok: true, value: { ...state, players: updatedPlayers, pendingDecisions: updatedDecisions } };
  }

  /**
   * Handles a player un-assigning their dice (changing their selection).
   * Restores citizen costs, clears action slots, and re-adds a pending ASSIGN_DICE decision.
   * Only allowed while the dice phase is still active (other players haven't all assigned yet).
   */
  private handleUnassignDice(
    state: GameState,
    playerId: string,
  ): Result<GameState, GameError> {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) {
      return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: 'Player not found' } };
    }

    const player = state.players[playerIndex];

    // Player must have already assigned (no pending decision and has action slots)
    const hasPending = state.pendingDecisions.some(d => d.playerId === playerId);
    const hasAssigned = player.actionSlots.some(s => s !== null);
    if (hasPending || !hasAssigned) {
      return { ok: false, error: { code: 'INVALID_DECISION', message: 'No assignment to undo' } };
    }

    // Restore citizen costs from the current assignment
    let totalCitizenCost = 0;
    for (const slot of player.actionSlots) {
      if (slot) {
        totalCitizenCost += slot.citizenCost;
      }
    }

    let updatedPlayer: typeof player = { ...player, actionSlots: [null, null, null] };
    if (totalCitizenCost > 0) {
      updatedPlayer = addCitizens(updatedPlayer, totalCitizenCost);
    }

    const updatedPlayers = [...state.players];
    updatedPlayers[playerIndex] = updatedPlayer;

    // Re-add an ASSIGN_DICE pending decision for this player
    // Use the same timeoutAt as other pending ASSIGN_DICE decisions to keep the shared timer consistent
    const existingAssignDecision = state.pendingDecisions.find(d => d.decisionType === 'ASSIGN_DICE');
    const timeoutAt = existingAssignDecision?.timeoutAt ?? (Date.now() + 60_000);
    const updatedDecisions = [
      ...state.pendingDecisions,
      {
        playerId,
        decisionType: 'ASSIGN_DICE' as const,
        timeoutAt,
        options: null as unknown,
      },
    ];

    return { ok: true, value: { ...state, players: updatedPlayers, pendingDecisions: updatedDecisions } };
  }

  isComplete(state: GameState): boolean {
    return state.pendingDecisions.length === 0;
  }

  autoResolve(state: GameState, playerId: string): GameState {
    const playerIndex = state.players.findIndex(p => p.playerId === playerId);
    if (playerIndex === -1) return state;

    const player = state.players[playerIndex];
    const pendingDecision = state.pendingDecisions.find(d => d.playerId === playerId);

    // If they have a ROLL_DICE decision, only auto-roll (don't auto-assign)
    if (pendingDecision?.decisionType === 'ROLL_DICE' || player.diceRoll === null) {
      const rollResult = this.handleRollDice(state, playerId);
      if (rollResult.ok) {
        let s = rollResult.value;
        const rolledPlayer = s.players.find(p => p.playerId === playerId);
        s = appendLogEntry(s, { roundNumber: s.roundNumber, phase: 'DICE', playerId, action: `Auto-rolled dice: ${rolledPlayer?.diceRoll?.join(', ') ?? '?'}`, details: { auto: true } });
        return s;
      }
      return state;
    }

    // If they have an ASSIGN_DICE decision, auto-assign
    if (pendingDecision?.decisionType === 'ASSIGN_DICE') {
      const currentPlayer = state.players.find(p => p.playerId === playerId)!;
      if (!currentPlayer.diceRoll || currentPlayer.diceRoll.length === 0) return state;

      // Auto-assign: pick cheapest affordable actions
      const sortedActions: Array<{ type: typeof ACTION_NUMBERS extends Record<infer K, number> ? K : never; number: number }> = (
        Object.entries(ACTION_NUMBERS) as Array<[keyof typeof ACTION_NUMBERS, number]>
      )
        .map(([type, num]) => ({ type, number: num }))
        .sort((a, b) => a.number - b.number);

      const dice = [...currentPlayer.diceRoll];
      const assignments: Array<{ slotIndex: 0 | 1 | 2; actionType: keyof typeof ACTION_NUMBERS; dieValue: number }> = [];

      for (let i = 0; i < dice.length && i < 3; i++) {
        const usedActions = new Set(assignments.map(a => a.actionType));
        const action = sortedActions.find(a => !usedActions.has(a.type));
        if (action) {
          assignments.push({
            slotIndex: i as 0 | 1 | 2,
            actionType: action.type,
            dieValue: dice[i],
          });
        }
      }

      const result = this.handleDiceAssignment(state, playerId, {
        type: 'ASSIGN_DICE',
        assignments,
      });

      if (result.ok) {
        let s = result.value;
        const actionNames = assignments.map(a => `${a.actionType}(${a.dieValue})`).join(', ');
        s = appendLogEntry(s, { roundNumber: s.roundNumber, phase: 'DICE', playerId, action: `Auto-assigned dice: ${actionNames}`, details: { auto: true, assignments } });
        return s;
      }
    }

    // Fallback: just remove the pending decision
    return {
      ...state,
      pendingDecisions: state.pendingDecisions.filter(d => d.playerId !== playerId),
    };
  }
}
