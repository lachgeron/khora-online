/**
 * Internal types for the optimal-play solver.
 *
 * Assumptions (per feature spec):
 * - Events are ignored entirely.
 * - Achievements are not pursued.
 * - Dice rolls are always perfect (no citizen cost for actions).
 * - Any knowledge token can be acquired via Military exploration.
 * - Citizens are effectively unbounded (but citizen track is still tracked for scoring).
 * - Only cards currently in hand are considered (Legislation / Council draws skipped).
 * - God-mode may opt into treating unpicked deck cards as playable.
 * - Opponents are frozen at calculation time.
 */

import type { KnowledgeColor, PoliticsCard, KnowledgeToken, ProgressTrackType } from '@khora/shared';
// KnowledgeToken kept for historical snapshot shape; not used in ActionChoice.

/**
 * Actions the solver considers.
 *
 * LEGISLATION is only offered as a candidate during round 1 (to reach the
 * 12-citizens achievement via Philosophy + Legislation + 2×Economy progress).
 * It's a "free" slot — does not consume a die slot. Outside of round 1 the
 * solver ignores Legislation entirely.
 */
export type SolverAction =
  | 'PHILOSOPHY'
  | 'CULTURE'
  | 'TRADE'
  | 'MILITARY'
  | 'POLITICS'
  | 'DEVELOPMENT'
  | 'LEGISLATION';

export const SOLVER_ACTIONS: SolverAction[] = [
  'PHILOSOPHY',
  'CULTURE',
  'TRADE',
  'MILITARY',
  'POLITICS',
  'DEVELOPMENT',
  'LEGISLATION',
];

/** Knowledge count, indexed by color. Majors and minors counted separately. */
export interface KnowledgeCounts {
  greenMinor: number;
  blueMinor: number;
  redMinor: number;
  greenMajor: number;
  blueMajor: number;
  redMajor: number;
}

export const EMPTY_KNOWLEDGE: KnowledgeCounts = {
  greenMinor: 0,
  blueMinor: 0,
  redMinor: 0,
  greenMajor: 0,
  blueMajor: 0,
  redMajor: 0,
};

/** Snapshot of a frozen opponent used for opponent-dependent card conditions. */
export interface FrozenOpponent {
  economyTrack: number;
  cultureTrack: number;
  militaryTrack: number;
}

/**
 * The core solver state — everything the solver needs to track per node.
 * This is a flat record for cheap cloning.
 */
export interface SolverState {
  round: number;                       // 1–9 (the round we are about to plan)

  // Mid-round fixed state (from snapshot). On round advance, reset.
  actionsAlreadyTaken: SolverAction[]; // already resolved this round (excluding LEGISLATION)
  slotsConsumedThisRound: number;      // total dice slots used this round (incl. skipped LEGISLATION)
  progressAlreadyDone: boolean;
  legislationDoneThisRound: boolean;   // true iff LEGISLATION resolved this round (free-slot tracking)

  // Tracks
  economyTrack: number;
  cultureTrack: number;
  militaryTrack: number;
  taxTrack: number;
  gloryTrack: number;
  troopTrack: number;
  citizenTrack: number;

  // Resources
  coins: number;
  philosophyTokens: number;
  knowledge: KnowledgeCounts;

  // City + devs
  cityId: string;
  developmentLevel: number;           // 1–4 (how many developments unlocked including starter)

  // Cards — represented as bitmasks over the snapshot's hand+played list.
  // We store bits; lookup is via the card index table attached to the solver.
  handMask: number;
  playedMask: number;

  // Public board tokens still available along this simulated line.
  boardTokens: BoardExplorationToken[];

  // Score track
  victoryPoints: number;
}

/** A single action chosen for this round, with any sub-choice. */
export type ActionChoice =
  | { type: 'PHILOSOPHY' }
  | { type: 'CULTURE' }
  | { type: 'TRADE'; buyMinor: KnowledgeColor | null }
  | { type: 'MILITARY'; explore: BoardExplorationToken[] }
  | { type: 'POLITICS'; cardIndex: number; philosophyPairs: number; scholarlyWelcomeColor?: KnowledgeColor }
  | {
      type: 'DEVELOPMENT';
      philosophyPairs: number;
      miletusDev2Tracks?: [ProgressTrackType, ProgressTrackType];
      spartaDev3Colors?: [KnowledgeColor, KnowledgeColor];
      argosDev2Reward?: 'TROOPS' | 'COINS' | 'VP' | 'CITIZENS';
    }
  | { type: 'LEGISLATION' };

/** The full choice set for one round. */
export interface MacroAction {
  actions: ActionChoice[];               // 1-3 new actions this round
  progress: ProgressTrackType[];         // 0+ tracks to advance (base + bonus + philosophy)
  philosophySpentOnProgress: number;     // # scrolls spent for extra progress advances
}

/** A description of what happens in one round, for display. */
export interface RoundPlan {
  round: number;
  description: string[];                 // human-readable bullets
  actionTypes: SolverAction[];           // action types the solver wants this round, in order
  vpBefore: number;
  vpAfter: number;
  coinsBefore: number;
  coinsAfter: number;
}

/** Final plan returned to the UI. */
export interface Plan {
  projectedFinalVP: number;
  vpBreakdown: {
    scoreTrack: number;
    developments: number;
    politicsCards: number;
    gloryTimesMajors: number;
  };
  currentRound: RoundPlan | null;        // what to do right now (null if game over / pre-game)
  futureRounds: RoundPlan[];             // remaining rounds
  partialResult: boolean;
  computeMs: number;
  exploredNodes: number;
}

/** Input to the solver — what the client extracts from game + private state. */
export interface SolverInput {
  // Direct state fields
  cityId: string;
  developmentLevel: number;
  coins: number;
  philosophyTokens: number;
  knowledgeTokens: KnowledgeToken[];
  economyTrack: number;
  cultureTrack: number;
  militaryTrack: number;
  taxTrack: number;
  gloryTrack: number;
  troopTrack: number;
  citizenTrack: number;
  victoryPoints: number;
  handCards: PoliticsCard[];
  playedCards: PoliticsCard[];
  availableGodModeCards: PoliticsCard[];
  godMode: boolean;

  // Round state
  currentRound: number;                  // 1–9
  actionsAlreadyTaken: SolverAction[];   // in the current round (excluding LEGISLATION)
  slotsConsumedThisRound: number;        // total resolved dice slots this round
  progressAlreadyDone: boolean;
  legislationDoneThisRound: boolean;     // true iff LEGISLATION was resolved this round
  /**
   * Achievement tokens still available for claiming THIS round (i.e. not yet
   * claimed by anyone, and the achievement phase has not yet run this round).
   * Empty for any round in which the achievement phase has already completed.
   * Only the *initial* simulated round considers these — future rounds in the
   * search tree assume opponents have grabbed whatever is left, per spec.
   */
  availableAchievementIds: string[];
  /**
   * Number of ACHIEVEMENT_TRACK_CHOICE decisions pending for this player. Set
   * during the ACHIEVEMENT phase (claims already determined server-side, only
   * the +1 Tax / +1 Glory pick remains). Zero outside that phase.
   */
  pendingAchievementChoices: number;
  initialRoundTaxApplied: boolean;       // true iff the TAXATION phase has already run this round (false only during OMEN)

  // Frozen opponents (for Power / Public Market)
  opponents: FrozenOpponent[];

  // Central-board exploration tokens (unexplored only; sorted desc by VP/coin value).
  // Used to pick actual explore targets with real skull costs + bonus VP/coins.
  boardTokens: BoardExplorationToken[];
}

/** A central-board exploration token available for Military exploration. */
export interface BoardExplorationToken {
  id: string;
  color: KnowledgeColor;
  tokenType: 'MINOR' | 'MAJOR';
  militaryRequirement: number;  // troops needed on track to explore
  skullCost: number;             // troops lost when exploring
  bonusCoins: number;
  bonusVP: number;
  isPersepolis?: boolean;
}

/** Reason a solver cannot produce a plan. */
export type SolverUnavailableReason =
  | 'PRE_GAME'      // CITY_SELECTION or DRAFT_POLITICS
  | 'GAME_OVER'     // game ended
  | 'UNKNOWN';

export type SolverResult =
  | { ok: true; plan: Plan }
  | { ok: false; reason: SolverUnavailableReason; message: string };
