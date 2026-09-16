import { ALL_CITIES, ALL_POLITICS_CARDS, STARTING_EVENT, RANDOM_EVENTS, FINAL_EVENT, getAllAchievements } from '../game-data';
import { makeTestGameState, makeTestPlayer } from '../test-helpers';
import { applyDevelopmentEffect } from '../city-abilities';
import { makeDefaultCentralBoardTokens } from '../integration';
import { DicePhaseManager } from '../phases/dice-phase';
import { simulate } from './simulation';

/** Reproducible round-one positions, with real starting resources and varied deals/dice. */
export function benchmarkPosition(cityId = 'athens', seed = 1, playerCount = 2) {
  if (playerCount < 2 || playerCount > 4 || !Number.isInteger(playerCount)) throw new Error('Use two to four players');
  if (!ALL_CITIES.some(c => c.id === cityId)) throw new Error(`Unknown city: ${cityId}`);
  let rng = seed;
  const random = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296);
  const deck = [...ALL_POLITICS_CARDS];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const cityIds = [cityId, cityId === 'sparta' ? 'miletus' : 'sparta'];
  cityIds.push(...ALL_CITIES.map(c => c.id).filter(id => !cityIds.includes(id)).slice(0, playerCount - 2));
  const players = cityIds.map((id, i) => {
    const city = ALL_CITIES.find(c => c.id === id)!;
    const t = city.startingTracks;
    return applyDevelopmentEffect(makeTestPlayer({ playerId: `player-${i + 1}`, playerName: `Player ${i + 1}`, cityId: id,
      coins: city.startingCoins, economyTrack: t.economy, cultureTrack: t.culture, militaryTrack: t.military,
      taxTrack: t.tax, gloryTrack: t.glory, troopTrack: t.troop, citizenTrack: t.citizen,
      handCards: deck.splice(0, 5),
    }), city.developments[0]);
  });
  let state = new DicePhaseManager().onEnter(makeTestGameState({
    gameId: `benchmark-${cityId}-${seed}`, currentPhase: 'DICE', players,
    currentEvent: STARTING_EVENT, eventDeck: [...RANDOM_EVENTS.slice(0, 7), FINAL_EVENT],
    centralBoardTokens: makeDefaultCentralBoardTokens(), politicsDeck: deck, availableAchievements: getAllAchievements(),
    predeterminedDice: Object.fromEntries(Array.from({ length: 9 }, (_, round) => [round + 1,
      Object.fromEntries(players.map(p => [p.playerId, Array.from({ length: 3 }, () => 1 + Math.floor(random() * 6))]))])),
  }));
  for (const p of players) state = simulate(state, p.playerId, { type: 'ROLL_DICE' })!;
  return state;
}
