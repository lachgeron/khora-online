/**
 * Apply a single SolverAction to a state.
 *
 * These are simplified transitions that capture the action's resource/VP
 * impact under the solver's assumptions (perfect dice, unbounded citizens,
 * any-token from exploration, events ignored).
 */

import type { SolverState, SolverAction, FrozenOpponent, ActionChoice } from './types';
import {
  cloneState,
  applyOngoingOnAction,
  applyOngoingOnPlayCard,
  applyImmediateCardEffect,
  minorBuyCost,
  exploreTroopDiscount,
} from './card-data';
import {
  applyDevOngoingOnAction,
  applyDevOngoingOnPlayCard,
  applyDevImmediateEffect,
  devDrachmaCost,
  hasSpartaDev1,
  hasThebesDev3,
} from './city-data';

/** Coins earned from a TRADE action at economy level. Base = economy track level. */
function tradeIncome(s: SolverState): number {
  return s.economyTrack;
}

/** Coins earned from a CULTURE action. Base = cultureTrack. */
function cultureIncome(s: SolverState): number {
  return s.cultureTrack;
}

/** Scrolls earned from PHILOSOPHY action. Base = 2. */
const PHILOSOPHY_SCROLLS = 2;

/** Apply a single action to state. Mutates state (assumed cloned). */
export function applyAction(
  s: SolverState,
  choice: ActionChoice,
  cardIds: string[],
  opponents: FrozenOpponent[],
  hasCardFn: (id: string) => boolean,
): void {
  const cityId = s.cityId;
  const devLevel = s.developmentLevel;

  switch (choice.type) {
    case 'PHILOSOPHY': {
      s.philosophyTokens += PHILOSOPHY_SCROLLS;
      applyOngoingOnAction(s, 'PHILOSOPHY', hasCardFn);
      applyDevOngoingOnAction(s, 'PHILOSOPHY', cityId, devLevel);
      return;
    }
    case 'CULTURE': {
      s.coins += cultureIncome(s);
      applyOngoingOnAction(s, 'CULTURE', hasCardFn);
      applyDevOngoingOnAction(s, 'CULTURE', cityId, devLevel);
      return;
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
        }
      }
      return;
    }
    case 'MILITARY': {
      // Exploration: grant chosen tokens, paying troops. Under solver assumption, can always get requested color.
      applyOngoingOnAction(s, 'MILITARY', hasCardFn);
      applyDevOngoingOnAction(s, 'MILITARY', cityId, devLevel);
      const discount = exploreTroopDiscount(hasCardFn) + (hasSpartaDev1(cityId, devLevel) ? 1 : 0);
      const thebesDouble = hasThebesDev3(cityId, devLevel);
      const maxExplore = thebesDouble ? 2 : 1;

      // Per solver spec: explore[] may contain up to `maxExplore` tokens.
      const toExplore = choice.explore.slice(0, maxExplore);
      for (const tok of toExplore) {
        // Minor cost = 2 troops; Major cost = 4 troops (standard). Discount reduces by `discount`.
        const baseCost = tok.tokenType === 'MAJOR' ? 4 : 2;
        const cost = Math.max(1, baseCost - discount);
        if (s.troopTrack < cost) continue;
        s.troopTrack -= cost;
        if (tok.tokenType === 'MAJOR') {
          if (tok.color === 'GREEN') s.knowledge.greenMajor += 1;
          else if (tok.color === 'BLUE') s.knowledge.blueMajor += 1;
          else s.knowledge.redMajor += 1;
        } else {
          if (tok.color === 'GREEN') s.knowledge.greenMinor += 1;
          else if (tok.color === 'BLUE') s.knowledge.blueMinor += 1;
          else s.knowledge.redMinor += 1;
        }
      }
      return;
    }
    case 'POLITICS': {
      const idx = choice.cardIndex;
      if (idx < 0 || idx >= cardIds.length) return;
      const cardBit = 1 << idx;
      if ((s.handMask & cardBit) === 0) return; // not in hand
      const cardId = cardIds[idx];
      // Pay cost (approximated by card definition — but we don't have full PoliticsCard here,
      // caller passes cardIds/handMask; cost handled by enumerator before calling applyAction).
      s.handMask &= ~cardBit;
      s.playedMask |= cardBit;
      // Play-card triggers
      applyOngoingOnPlayCard(s, hasCardFn, cardId);
      applyDevOngoingOnPlayCard(s, cityId, devLevel);
      // Immediate effect
      applyImmediateCardEffect(s, cardId, opponents);
      // Action triggers
      applyOngoingOnAction(s, 'POLITICS', hasCardFn);
      applyDevOngoingOnAction(s, 'POLITICS', cityId, devLevel);
      return;
    }
    case 'DEVELOPMENT': {
      // Cannot exceed 4 developments
      if (s.developmentLevel >= 4) return;
      const newLevel = s.developmentLevel + 1;
      const baseCost = devDrachmaCost(cityId, newLevel);
      const cost = Math.max(0, baseCost);
      if (s.coins < cost) return;
      s.coins -= cost;
      s.developmentLevel = newLevel;
      applyDevImmediateEffect(s, cityId, newLevel);
      applyOngoingOnAction(s, 'DEVELOPMENT', hasCardFn);
      applyDevOngoingOnAction(s, 'DEVELOPMENT', cityId, devLevel + 1);
      return;
    }
  }
}

/** Actions-phase action name from ActionChoice. */
export function toSolverAction(choice: ActionChoice): SolverAction {
  return choice.type;
}

/** Shallow clone wrapper. */
export function cloneForTransition(s: SolverState): SolverState {
  return cloneState(s);
}
