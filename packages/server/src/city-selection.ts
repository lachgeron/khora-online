/**
 * City selection logic for Khora Online.
 *
 * Manages the city selection phase where each player picks a unique city-state.
 * All functions are pure where possible — selectCity and autoAssign return
 * Result types rather than throwing.
 */

import type { CityCard, PlayerState, PlayerInfo, Result, GameError } from '@khora/shared';
import { applyDevelopmentEffect } from './city-abilities';

/**
 * Manages the city selection phase for a game session.
 */
export class CitySelectionManager {
  private readonly cities: ReadonlyArray<CityCard>;
  private readonly players: ReadonlyArray<PlayerInfo>;
  private readonly selections = new Map<string, string>(); // playerId → cityId

  constructor(cities: CityCard[], players: PlayerInfo[]) {
    this.cities = [...cities];
    this.players = [...players];
  }

  /**
   * Attempts to select a city for a player.
   * Returns an error if the city is already taken or the player/city is invalid.
   */
  selectCity(playerId: string, cityId: string): Result<void, GameError> {
    // Validate player exists
    if (!this.players.some(p => p.playerId === playerId)) {
      return {
        ok: false,
        error: { code: 'PLAYER_NOT_FOUND', message: `Player "${playerId}" is not in this game.` },
      };
    }

    // Validate city exists
    if (!this.cities.some(c => c.id === cityId)) {
      return {
        ok: false,
        error: { code: 'INVALID_DECISION', message: `City "${cityId}" does not exist.` },
      };
    }

    // Check if player already selected
    if (this.selections.has(playerId)) {
      return {
        ok: false,
        error: { code: 'DUPLICATE_ACTION', message: `Player "${playerId}" has already selected a city.` },
      };
    }

    // Check if city is already taken
    const takenBy = [...this.selections.entries()].find(([, cId]) => cId === cityId);
    if (takenBy) {
      return {
        ok: false,
        error: { code: 'CITY_TAKEN', message: `City "${cityId}" has already been selected by another player.` },
      };
    }

    this.selections.set(playerId, cityId);
    return { ok: true, value: undefined };
  }

  /** Returns the cities that have not yet been selected. */
  getAvailableCities(): CityCard[] {
    const takenIds = new Set(this.selections.values());
    return this.cities.filter(c => !takenIds.has(c.id));
  }

  /**
   * Randomly assigns an available city to a player (used on timeout).
   * Returns an error if no cities are available or the player already selected.
   */
  autoAssign(playerId: string): Result<string, GameError> {
    if (!this.players.some(p => p.playerId === playerId)) {
      return {
        ok: false,
        error: { code: 'PLAYER_NOT_FOUND', message: `Player "${playerId}" is not in this game.` },
      };
    }

    if (this.selections.has(playerId)) {
      return {
        ok: false,
        error: { code: 'DUPLICATE_ACTION', message: `Player "${playerId}" has already selected a city.` },
      };
    }

    const available = this.getAvailableCities();
    if (available.length === 0) {
      return {
        ok: false,
        error: { code: 'INVALID_DECISION', message: 'No cities available for auto-assignment.' },
      };
    }

    const chosen = available[Math.floor(Math.random() * available.length)];
    this.selections.set(playerId, chosen.id);
    return { ok: true, value: chosen.id };
  }

  /**
   * Creates a PlayerState from a PlayerInfo and a CityCard,
   * initializing resources, tracks, and abilities from the city card's starting values.
   */
  initializePlayerState(playerInfo: PlayerInfo, cityCard: CityCard): PlayerState {
    let playerState: PlayerState = {
      playerId: playerInfo.playerId,
      playerName: playerInfo.playerName,
      cityId: cityCard.id,

      coins: cityCard.startingCoins,

      economyTrack: cityCard.startingTracks.economy,
      cultureTrack: cityCard.startingTracks.culture,
      militaryTrack: cityCard.startingTracks.military,
      taxTrack: cityCard.startingTracks.tax,
      gloryTrack: cityCard.startingTracks.glory,
      troopTrack: cityCard.startingTracks.troop,
      citizenTrack: cityCard.startingTracks.citizen,

      philosophyTokens: 0,
      knowledgeTokens: [],
      handCards: [],
      playedCards: [],
      developmentLevel: 1,

      diceRoll: null,
      actionSlots: [null, null, null],

      victoryPoints: 0,

      isConnected: true,
      hasFlagged: false,
      timeBankMs: 120_000,
    };

    // Apply the 1st development's immediate effect (already active at game start)
    const firstDev = cityCard.developments[0];
    if (firstDev && firstDev.effectType === 'IMMEDIATE') {
      playerState = applyDevelopmentEffect(playerState, firstDev);
    }

    return playerState;
  }

  /** Returns true when every player has selected a city. */
  isComplete(): boolean {
    return this.players.every(p => this.selections.has(p.playerId));
  }

  /** Returns the current selections map (playerId → cityId). */
  getSelections(): Map<string, string> {
    return new Map(this.selections);
  }
}
