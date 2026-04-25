/**
 * Apply a single SolverAction to a state.
 *
 * These are simplified transitions that capture the action's resource/VP
 * impact under the solver's assumptions (perfect dice, unbounded citizens,
 * any-token from exploration, events ignored).
 */

import type { SolverState, SolverAction, FrozenOpponent, ActionChoice } from './types';
import type { PoliticsCard } from '../types';
import {
  addMaskBit,
  cloneState,
  hasMaskBit,
  applyOngoingOnAction,
  applyOngoingOnPlayCard,
  applyImmediateCardEffect,
  minorBuyCost,
  removeMaskBit,
  exploreTroopDiscount,
} from './card-data';
import { capTroops } from './tracks';
import {
  applyDevOngoingOnAction,
  applyDevOngoingOnPlayCard,
  applyDevImmediateEffect,
  devDrachmaCost,
  hasSpartaDev1,
  hasThebesDev3,
} from './city-data';

/** Coins earned from a TRADE action. Base = economy track level + 1. */
function tradeIncome(s: SolverState): number {
  return s.economyTrack + 1;
}

/** VP earned from a CULTURE action. Equal to culture track level. */
function cultureVP(s: SolverState): number {
  return s.cultureTrack;
}

/** Scrolls earned from PHILOSOPHY action. Base = 1. */
const PHILOSOPHY_SCROLLS = 1;

/** Apply a single action to state. Mutates state (assumed cloned). */
export function applyAction(
  s: SolverState,
  choice: ActionChoice,
  cardIds: string[],
  allCards: PoliticsCard[],
  opponents: FrozenOpponent[],
  hasCardFn: (id: string) => boolean,
): boolean {
  const cityId = s.cityId;
  const devLevel = s.developmentLevel;

  switch (choice.type) {
    case 'PHILOSOPHY': {
      s.philosophyTokens += PHILOSOPHY_SCROLLS;
      applyOngoingOnAction(s, 'PHILOSOPHY', hasCardFn);
      applyDevOngoingOnAction(s, 'PHILOSOPHY', cityId, devLevel);
      return true;
    }
    case 'CULTURE': {
      s.victoryPoints += cultureVP(s);
      applyOngoingOnAction(s, 'CULTURE', hasCardFn);
      applyDevOngoingOnAction(s, 'CULTURE', cityId, devLevel);
      return true;
    }
    case 'TRADE': {
      s.coins += tradeIncome(s);
      applyOngoingOnAction(s, 'TRADE', hasCardFn);
      applyDevOngoingOnAction(s, 'TRADE', cityId, devLevel);
      if (choice.buyMinor) {
        const cost = minorBuyCost(hasCardFn);
        if (s.coins >= cost) {
          s.coins -= cost;
          if (choice.buyMinor === 'GREEN') s.knowledge.greenMinor += 1;
          else if (choice.buyMinor === 'BLUE') s.knowledge.blueMinor += 1;
          else s.knowledge.redMinor += 1;
        } else {
          return false;
        }
      }
      return true;
    }
    case 'MILITARY': {
      // Step 1: Gain troops equal to military track level (matches server military-resolver).
      s.troopTrack += s.militaryTrack;
      // Step 2: Exploration — use real board tokens with their skull cost + bonus VP/coins.
      applyOngoingOnAction(s, 'MILITARY', hasCardFn);
      applyDevOngoingOnAction(s, 'MILITARY', cityId, devLevel);
      const discount = exploreTroopDiscount(hasCardFn) + (hasSpartaDev1(cityId, devLevel) ? 1 : 0);
      const thebesDouble = hasThebesDev3(cityId, devLevel);
      const maxExplore = thebesDouble ? 2 : 1;

      // Per solver spec: explore[] may contain up to `maxExplore` tokens.
      const toExplore = choice.explore.slice(0, maxExplore);
      const exploredIds: string[] = [];
      for (const tok of toExplore) {
        // Requirement: troop TRACK must meet militaryRequirement (note: track, not reserve).
        // Then pay skull cost (troops lost), and gain bonus coins + VP.
        if (s.troopTrack < tok.militaryRequirement) return false;
        const cost = Math.max(0, tok.skullCost - discount);
        if (s.troopTrack < cost) return false;
        s.troopTrack -= cost;
        exploredIds.push(tok.id);
        s.coins += tok.bonusCoins;
        s.victoryPoints += tok.bonusVP;
        if (tok.isPersepolis) {
          // Persepolis grants 1 major of each color
          s.knowledge.greenMajor += 1;
          s.knowledge.blueMajor += 1;
          s.knowledge.redMajor += 1;
        } else if (tok.tokenType === 'MAJOR') {
          if (tok.color === 'GREEN') s.knowledge.greenMajor += 1;
          else if (tok.color === 'BLUE') s.knowledge.blueMajor += 1;
          else s.knowledge.redMajor += 1;
        } else {
          if (tok.color === 'GREEN') s.knowledge.greenMinor += 1;
          else if (tok.color === 'BLUE') s.knowledge.blueMinor += 1;
          else s.knowledge.redMinor += 1;
        }
      }
      if (exploredIds.length > 0) {
        const consumed = new Set(exploredIds);
        s.boardTokens = s.boardTokens.filter(tok => !consumed.has(tok.id));
      }
      capTroops(s);
      return true;
    }
    case 'POLITICS': {
      const idx = choice.cardIndex;
      if (idx < 0 || idx >= cardIds.length) return false;
      if (hasMaskBit(s.playedMask, idx)) return false;
      const inHand = hasMaskBit(s.handMask, idx);
      if (!inHand && !s.godMode) return false; // not in hand
      if (s.handSlots <= 0) return false;
      const cardId = cardIds[idx];
      const card = allCards[idx];
      if (!card) return false;
      // Pay drachma cost
      if (s.coins < card.cost) return false;
      s.coins -= card.cost;
      // Pay philosophy scrolls to cover missing knowledge (2 scrolls = 1 substitution)
      const pairsNeeded = choice.philosophyPairs ?? 0;
      if (s.philosophyTokens < pairsNeeded * 2) return false;
      s.philosophyTokens -= pairsNeeded * 2;
      if (inHand) s.handMask = removeMaskBit(s.handMask, idx);
      else s.handMask = removeLowestValueHandCard(s.handMask, allCards);
      s.handSlots -= 1;
      s.playedMask = addMaskBit(s.playedMask, idx);
      // Play-card triggers
      applyOngoingOnPlayCard(s, hasCardFn, cardId);
      applyDevOngoingOnPlayCard(s, cityId, devLevel);
      // Immediate effect
      applyImmediateCardEffect(s, cardId, opponents, {
        scholarlyWelcomeColor: choice.scholarlyWelcomeColor,
        playedCardIndex: idx,
      });
      // Action triggers
      applyOngoingOnAction(s, 'POLITICS', hasCardFn);
      applyDevOngoingOnAction(s, 'POLITICS', cityId, devLevel);
      return true;
    }
    case 'DEVELOPMENT': {
      // Cannot exceed 4 developments
      if (s.developmentLevel >= 4) return false;
      const newLevel = s.developmentLevel + 1;
      const baseCost = devDrachmaCost(cityId, newLevel);
      const cost = Math.max(0, baseCost);
      if (s.coins < cost) return false;
      // Pay philosophy scrolls to cover missing knowledge
      const pairsNeeded = choice.philosophyPairs ?? 0;
      if (s.philosophyTokens < pairsNeeded * 2) return false;
      s.philosophyTokens -= pairsNeeded * 2;
      s.coins -= cost;
      s.developmentLevel = newLevel;
      applyDevImmediateEffect(s, cityId, newLevel, {
        miletusDev2Tracks: choice.miletusDev2Tracks,
        spartaDev3Colors: choice.spartaDev3Colors,
        argosDev2Reward: choice.argosDev2Reward,
        hasCard: hasCardFn,
      });
      applyOngoingOnAction(s, 'DEVELOPMENT', hasCardFn);
      applyDevOngoingOnAction(s, 'DEVELOPMENT', cityId, devLevel + 1);
      return true;
    }
    case 'LEGISLATION': {
      // Grants +3 citizens (capped at 15)
      // and draws 2 politics cards, keeping 1. Normal mode does not invent the
      // unknown card identity; god-mode can use the added hand slot against
      // its deck-card pool.
      if (s.legislationDoneThisRound) return false;
      s.citizenTrack = Math.min(15, s.citizenTrack + 3);
      s.handSlots += 1;
      s.legislationDoneThisRound = true;
      applyOngoingOnAction(s, 'LEGISLATION', hasCardFn);
      applyDevOngoingOnAction(s, 'LEGISLATION', cityId, devLevel);
      return true;
    }
  }
  return false;
}

function removeLowestValueHandCard(handMask: number, allCards: PoliticsCard[]): number {
  let removeIndex = -1;
  let removeScore = Infinity;
  for (let i = 0; i < allCards.length; i++) {
    if (!hasMaskBit(handMask, i)) continue;
    const card = allCards[i];
    const score = (card?.cost ?? 0) + (card?.type === 'END_GAME' ? 3 : 0);
    if (score < removeScore) {
      removeScore = score;
      removeIndex = i;
    }
  }
  return removeIndex >= 0 ? removeMaskBit(handMask, removeIndex) : handMask;
}

/** Actions-phase action name from ActionChoice. */
export function toSolverAction(choice: ActionChoice): SolverAction {
  return choice.type;
}

/** Shallow clone wrapper. */
export function cloneForTransition(s: SolverState): SolverState {
  return cloneState(s);
}
