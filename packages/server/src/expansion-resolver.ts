import type { ClientMessage, GameError, GameState, Result } from '@khora/shared';
import { PoliticsResolver } from './actions/politics-resolver';
import { queueExpansionChoice } from './expansion-choices';
import { applyOngoingEffects } from './card-handlers';
import { applyOngoingDevEffects } from './city-dev-handlers';
import { addCitizens, MAX_TAX_GLORY_TRACK } from './resources';
import { appendLogEntry, logPlayerDiff } from './game-log';

export function resolveExpansionChoice(state: GameState, playerId: string, message: ClientMessage): Result<GameState, GameError> {
  const choice = state.expansionChoices?.[0];
  const fail = (message: string): Result<GameState, GameError> => ({ ok: false, error: { code: 'INVALID_DECISION', message } });
  if (!choice || choice.playerId !== playerId) return fail('This card choice is not yours.');
  if (message.type !== 'RESOLVE_EXPANSION') return fail('Resolve the card choice first.');
  const before = state.players.find(p => p.playerId === playerId)!;
  let player = before;
  let result: GameState = { ...state, expansionChoices: state.expansionChoices!.slice(1) };
  const amount = message.amount ?? 0;
  if (!Number.isInteger(amount) || amount < 0) return fail('Choose a non-negative whole number.');
  let label = choice.cardId;
  switch (choice.kind) {
    case 'TOKEN': {
      const token = player.knowledgeTokens.find(t => t.id === message.value && t.tokenType === 'MINOR');
      if (!token) return fail('Choose one of your minor tokens.');
      player = { ...player, knowledgeTokens: player.knowledgeTokens.filter(t => t.id !== token.id), victoryPoints: player.victoryPoints + 6 };
      label = 'Heraclides: sacrificed a minor token for 6 VP';
      break;
    }
    case 'COINS':
      if (amount > Math.min(3, player.coins)) return fail('Spend at most 3 available drachma.');
      player = addCitizens({ ...player, coins: player.coins - amount }, amount * 2);
      label = `Demagorgy: paid ${amount} drachma for ${amount * 2} citizens`;
      break;
    case 'DRAW': {
      const card = choice.cards?.find(c => c.id === message.value);
      if (!card || !state.politicsDeck.some(c => c.id === card.id)) return fail('Choose one of the offered bottom cards.');
      player = { ...player, handCards: [...player.handCards, card] };
      result = { ...result, politicsDeck: result.politicsDeck.filter(c => c.id !== card.id) };
      result = queueExpansionChoice(result, { playerId, cardId: choice.cardId, kind: 'POLITICS' });
      label = 'Mausoleum of Halikarnassos: drew a card from the bottom of the deck';
      break;
    }
    case 'ENLIST':
      if (amount > 1 || amount > player.citizenTrack) return fail('You may exchange 1 available citizen.');
      player = { ...player, citizenTrack: player.citizenTrack - amount, troopTrack: player.troopTrack + amount };
      label = amount ? 'Enlistment: exchanged 1 citizen for 1 troop' : 'Enlistment: declined';
      break;
    case 'REWARD':
      if (message.value !== 'scroll' && message.value !== 'coin') return fail('Choose a scroll or a drachma.');
      player = message.value === 'scroll' ? { ...player, philosophyTokens: player.philosophyTokens + 1 } : { ...player, coins: player.coins + 1 };
      label = `Epidaurus: gained 1 ${message.value === 'scroll' ? 'scroll' : 'drachma'}`;
      break;
    case 'GLORY':
      if (amount > (choice.amount ?? 0)) return fail('Cannot replace more Glory than you would gain.');
      player = { ...player, gloryTrack: Math.min(MAX_TAX_GLORY_TRACK, player.gloryTrack + (choice.amount ?? 0) - amount), victoryPoints: player.victoryPoints + amount * 3 };
      label = `Frescoes by Polygnotus: replaced ${amount} Glory with ${amount * 3} VP`;
      break;
    case 'POLITICS': {
      if (message.value === 'skip') break;
      const extraCost = choice.extraCost ?? 0;
      if (player.coins < extraCost) return fail('Not enough drachma for this card play.');
      const card = player.handCards.find(c => c.id === message.choices?.targetCardId);
      const paid = { ...result, players: result.players.map(p => p.playerId === playerId ? { ...p, coins: p.coins - extraCost } : p) };
      const played = new PoliticsResolver().resolve(paid, playerId, message.choices ?? {});
      if (!played.ok) return played;
      result = played.value;
      // Architect grants a card play; Mausoleum and Ostracism grant a Politics action.
      if (choice.cardId !== 'architect') {
        result = applyOngoingEffects(result, playerId, { type: 'ON_ACTION', actionType: 'POLITICS' });
      }
      result = applyOngoingDevEffects(result, playerId, 'POLITICS');
      if (card?.id === 'ostracism') result = queueExpansionChoice(result, { playerId, cardId: 'ostracism', kind: 'POLITICS' });
      player = result.players.find(p => p.playerId === playerId)!;
      label = `${choice.cardId === 'architect' ? 'Architect' : 'Bonus politics'}: played ${card?.name}`;
      break;
    }
  }
  result = { ...result, players: result.players.map(p => p.playerId === playerId ? player : p) };
  result = appendLogEntry(result, { roundNumber: state.roundNumber, phase: state.currentPhase, playerId, action: label, details: { source: choice.cardId } });
  result = logPlayerDiff(result, before, player, { roundNumber: state.roundNumber, phase: state.currentPhase, source: choice.cardId });
  return { ok: true, value: result };
}

export function autoResolveExpansionChoice(state: GameState): GameState {
  const choice = state.expansionChoices?.[0];
  if (!choice) return state;
  const player = state.players.find(p => p.playerId === choice.playerId)!;
  const value = choice.kind === 'TOKEN' ? player.knowledgeTokens.find(t => t.tokenType === 'MINOR')?.id
    : choice.kind === 'DRAW' ? choice.cards?.[0]?.id
    : choice.kind === 'REWARD' ? 'scroll' : 'skip';
  const result = resolveExpansionChoice(state, choice.playerId, { type: 'RESOLVE_EXPANSION', value, amount: 0 });
  return result.ok ? result.value : { ...state, expansionChoices: state.expansionChoices!.slice(1) };
}
