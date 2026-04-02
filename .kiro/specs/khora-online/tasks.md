# Implementation Plan: Khora Online

## Overview

Incremental implementation of the Khora: Rise of an Empire online multiplayer board game. The plan starts with shared types and core game logic (state machine, resource management), builds out each phase manager and action resolver, adds scoring, then layers on networking (REST + WebSocket), persistence, and client UI. Property-based tests are integrated alongside the components they validate.

## Tasks

- [x] 1. Set up project structure, shared types, and core data models
  - [x] 1.1 Initialize TypeScript monorepo with server and shared packages
    - Create `packages/shared` for types and `packages/server` for game logic
    - Configure TypeScript, ESLint, Vitest, and fast-check
    - _Requirements: N/A (infrastructure)_

  - [x] 1.2 Define all shared type definitions and data models
    - Create `GameState`, `PlayerState`, `ActionSlot`, `EventCard`, `PoliticsCard`, `Decree`, `AchievementToken`, `CityCard` interfaces
    - Create `GameEffect`, `GloryCondition`, `AchievementCondition`, `ScoringRule` types
    - Create `ClientMessage`, `ServerMessage`, `PublicGameState`, `PrivatePlayerState`, `PublicPlayerState` types
    - Create `GamePhase`, `ActionType`, `ResourceType`, `TrackType`, `DecisionType` enums/unions
    - _Requirements: 19.2, 19.3, 21.2_

  - [x] 1.3 Create custom fast-check arbitraries for property-based testing
    - Implement `arbGameState`, `arbPlayerState`, `arbDiceAssignment`, `arbCityCard`, `arbEventCard`, `arbPoliticsCard`, `arbTrackLevel`, `arbResourceAmount` generators
    - _Requirements: N/A (test infrastructure)_

- [x] 2. Implement State Machine and round structure
  - [x] 2.1 Implement the StateMachine class
    - Enforce legal phase transitions: Lobby → CitySelection → Omen → Taxation → Dice → Actions → Progress → Glory → Achievement → (loop or FinalScoring)
    - Track `currentPhase` and `roundNumber` (1–9)
    - `canTransition`, `transition`, `isGameOver` methods
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 2.2 Write property test for state machine phase order
    - **Property 9: Game State Machine Phase Order**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 3. Implement resource management and validation
  - [x] 3.1 Implement resource transaction helpers
    - Functions to add/subtract resources from `PlayerState` (coins, citizens, knowledge tokens, troops)
    - Validate sufficient resources before any deduction; reject and return error if insufficient
    - Ensure no resource count goes below zero
    - _Requirements: 27.1, 27.2, 27.3_

  - [ ]* 3.2 Write property test for resource non-negativity invariant
    - **Property 43: Resource Non-Negativity Invariant**
    - **Validates: Requirements 27.1, 27.2, 27.3**

- [x] 4. Implement Lobby management
  - [x] 4.1 Implement Lobby creation and join logic
    - Generate unique 6-character alphanumeric invite codes
    - Add players to lobby by invite code
    - Enforce 2–4 player bounds (reject join at 4, prevent start below 2)
    - Remove player on disconnect, notify remaining
    - Start game transitions all lobby players into a game session
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ]* 4.2 Write property tests for lobby management
    - **Property 1: Invite Code Uniqueness**
    - **Property 2: Lobby Join Round-Trip**
    - **Property 3: Lobby Player Count Bounds**
    - **Property 4: Lobby Start Transfers All Players**
    - **Property 5: Lobby Disconnect Removes Player**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.7**

- [x] 5. Implement City Selection
  - [x] 5.1 Implement city selection logic
    - Present available cities to players
    - Prevent duplicate city selection
    - Initialize player state from city card starting values (resources, tracks, abilities)
    - Auto-assign on 120-second timeout from remaining available cities
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [ ]* 5.2 Write property tests for city selection
    - **Property 6: City Selection Uniqueness**
    - **Property 7: City Initialization Matches Card**
    - **Property 8: City Selection Timeout Assigns Valid City**
    - **Validates: Requirements 2.2, 2.3, 2.4**

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Omen Phase
  - [x] 7.1 Implement OmenPhaseManager
    - Reveal top event card from deck, decrease deck size by 1
    - Display event card effects, glory conditions, penalties to all players
    - Apply immediate global effects to game state
    - Use pre-shuffled event deck
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ]* 7.2 Write property tests for Omen phase
    - **Property 10: Omen Phase Draws Top Event Card**
    - **Property 11: Event Card Immediate Effects Applied**
    - **Property 12: Event Deck Shuffled**
    - **Validates: Requirements 4.1, 4.3, 4.4**

- [x] 8. Implement Taxation Phase
  - [x] 8.1 Implement TaxationPhaseManager
    - Grant coins based on economy track level using tax table
    - Grant citizens based on culture track level using population table
    - Apply city-specific and politics card modifiers before distributing
    - Update and display resource totals
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 8.2 Write property test for taxation income
    - **Property 13: Taxation Income Correctness**
    - **Validates: Requirements 5.1, 5.2, 5.3**

- [x] 9. Implement Dice Phase
  - [x] 9.1 Implement DicePhaseManager
    - Roll two six-sided dice per player (server-side RNG, values 1–6)
    - Show dice only to owning player (private state)
    - Prompt player to select two different actions and assign one die each
    - Prevent duplicate action selection
    - Calculate citizen cost when die value < action number
    - Auto-assign on 120-second timeout
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [ ]* 9.2 Write property tests for dice phase
    - **Property 14: Dice Values In Range**
    - **Property 16: No Duplicate Action Selection**
    - **Property 17: Die Deficit Citizen Cost**
    - **Property 18: Dice Timeout Assigns Valid Actions**
    - **Validates: Requirements 6.1, 6.4, 6.5, 6.7**

- [x] 10. Implement Action Resolvers (Actions 1–7)
  - [x] 10.1 Implement PhilosophyResolver (Action 1)
    - Grant knowledge tokens per action rules
    - Allow spending knowledge tokens on knowledge card effects
    - _Requirements: 7.1, 7.2_

  - [x] 10.2 Implement LegislationResolver (Action 2)
    - Draft a decree card from available options
    - Apply decree ongoing effect immediately
    - Enforce maximum decree limit
    - _Requirements: 8.1, 8.2, 8.3_

  - [x] 10.3 Implement CultureResolver (Action 3)
    - Grant victory points based on culture track level and action rules
    - _Requirements: 9.1_

  - [x] 10.4 Implement TradeResolver (Action 4)
    - Grant coins based on economy track level and action rules
    - Apply trade bonuses from politics cards and city abilities
    - _Requirements: 10.1, 10.2_

  - [x] 10.5 Implement MilitaryResolver (Action 5)
    - Grant troop tokens based on military track level and action rules
    - Update and display troop count to all players
    - _Requirements: 11.1, 11.2_

  - [x] 10.6 Implement PoliticsResolver (Action 6)
    - Display available politics cards in market
    - Allow purchase by paying coin cost
    - Skip purchase if insufficient coins, inform player
    - Apply immediate effects, register ongoing/end-game effects
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 10.7 Implement DevelopmentResolver (Action 7)
    - Allow track advancement by spending required resources
    - Enforce track advancement costs
    - Apply bonuses triggered by reaching specific track levels
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ]* 10.8 Write property tests for action resolvers
    - **Property 19: Philosophy Action Grants Knowledge Tokens**
    - **Property 20: Legislation Action Grants Decree**
    - **Property 21: Culture Action Grants Victory Points**
    - **Property 22: Trade Action Grants Coins**
    - **Property 23: Military Action Grants Troops**
    - **Property 24: Politics Card Purchase Correctness**
    - **Property 25: Development Action Track Advancement**
    - **Validates: Requirements 7.1, 8.1, 8.2, 8.3, 9.1, 10.1, 10.2, 11.1, 12.2, 12.3, 12.4, 13.1, 13.2**

- [x] 11. Implement ActionPhaseManager and action resolution order
  - [x] 11.1 Implement ActionPhaseManager
    - Resolve all players' actions in ascending order of action number (1 through 7)
    - Resolve same-action-number players simultaneously
    - Wait for each action number's resolution before proceeding to next
    - Integrate all 7 action resolvers
    - _Requirements: 14.1, 14.2, 14.3_

  - [ ]* 11.2 Write property test for action resolution order
    - **Property 26: Action Resolution Order**
    - **Validates: Requirements 14.1, 14.2**

- [x] 12. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Implement Progress Phase
  - [x] 13.1 Implement ProgressPhaseManager
    - Allow each player to advance tracks by spending citizens
    - Enforce citizen cost per track level advancement
    - Prevent track advancement beyond level 7
    - Apply bonuses triggered by reaching specific track levels
    - Proceed to Glory phase when all players complete or skip
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_

  - [ ]* 13.2 Write property tests for progress phase
    - **Property 27: Progress Phase Track Advancement**
    - **Property 28: Track Level Bonus Application**
    - **Validates: Requirements 15.1, 15.2, 15.3, 13.3, 15.4**

- [x] 14. Implement Glory Phase
  - [x] 14.1 Implement GloryPhaseManager
    - Evaluate each player against current event card's glory conditions
    - Award victory points to qualifying players
    - Display glory points earned per player for the round
    - _Requirements: 16.1, 16.2, 16.3_

  - [ ]* 14.2 Write property test for glory phase
    - **Property 29: Glory Phase Evaluation Correctness**
    - **Validates: Requirements 16.1, 16.2**

- [x] 15. Implement Achievement Phase
  - [x] 15.1 Implement AchievementPhaseManager
    - Evaluate each player against unclaimed achievement conditions
    - Allow qualifying players to claim achievements
    - Prevent double-claiming of achievement tokens
    - Apply military track / troop count tiebreaker when multiple players qualify
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [ ]* 15.2 Write property tests for achievement phase
    - **Property 30: Achievement Uniqueness Invariant**
    - **Property 31: Achievement Tiebreaker Correctness**
    - **Validates: Requirements 17.3, 17.1, 17.4**

- [x] 16. Implement Scoring Engine and final scoring
  - [x] 16.1 Implement ScoringEngine
    - `calculateGloryPoints` for per-round glory evaluation
    - `calculateFinalScores` summing all VP sources: glory, achievements, politics cards, decrees, track bonuses, resource conversion, troop bonuses
    - `applyTiebreakers` using most citizens then most coins
    - Produce `FinalScoreBoard` with rankings and breakdown
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5_

  - [ ]* 16.2 Write property tests for scoring
    - **Property 32: Final Score Calculation Correctness**
    - **Property 33: Final Ranking Correctness**
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5**

- [x] 17. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 18. Implement Game Engine orchestrator
  - [x] 18.1 Implement GameEngine class
    - `initializeGame`: create game state from player info and city selections, shuffle event deck, set up politics market and achievements
    - `handlePlayerDecision`: validate decision, apply via state machine and phase managers, broadcast updates
    - `handleTimeout`: auto-resolve pending decisions using default behavior
    - `getFullStateForPlayer`: return filtered public + private state for reconnection
    - Wire state machine, all phase managers, action resolvers, and scoring engine together
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 14.1, 14.2, 14.3_

- [x] 19. Implement visibility filtering
  - [x] 19.1 Implement state visibility filtering
    - Build `PublicGameState` and `PublicPlayerState` from full `GameState`
    - Build `PrivatePlayerState` for the requesting player only
    - Ensure no player's private info (coins, citizens, knowledge tokens, dice, cards) leaks to other players
    - _Requirements: 19.2, 19.3_

  - [ ]* 19.2 Write property test for visibility filtering
    - **Property 15: Dice Visibility Filtering**
    - **Property 34: State Visibility Filtering**
    - **Validates: Requirements 6.2, 19.2, 19.3**

- [x] 20. Implement City Ability enforcement
  - [x] 20.1 Implement city ability system
    - Apply each city's unique starting ability throughout the game
    - Ensure city ability modifiers are applied consistently in all relevant phases and actions
    - Display active city abilities on city board view
    - _Requirements: 26.1, 26.2, 26.3_

  - [ ]* 20.2 Write property test for city ability consistency
    - **Property 42: City Ability Consistency**
    - **Validates: Requirements 26.1, 26.2**

- [x] 21. Implement Politics Card Market
  - [x] 21.1 Implement politics card market management
    - Maintain visible market of politics cards
    - Replace purchased card with new card from deck
    - Display card cost, type, and effect text to all players
    - _Requirements: 28.1, 28.2, 28.3_

  - [ ]* 21.2 Write property test for market replenishment
    - **Property 44: Politics Market Replenishment**
    - **Validates: Requirements 28.1, 28.2**

- [x] 22. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 23. Implement Game State serialization and persistence
  - [x] 23.1 Implement GameState serialization/deserialization
    - Serialize complete GameState to JSON after each phase
    - Deserialize and restore exact saved state
    - _Requirements: 21.1, 21.2, 21.3, 21.4_

  - [ ]* 23.2 Write property test for serialization round-trip
    - **Property 38: Game State Serialization Round-Trip**
    - **Validates: Requirements 21.2, 21.3, 21.4**

  - [x] 23.3 Implement PersistenceLayer with PostgreSQL
    - `saveGameState`, `loadGameState`, `deleteGameState`
    - Retry logic (3 retries with exponential backoff) for DB failures
    - _Requirements: 21.1_

- [x] 24. Implement Pretty Printer
  - [x] 24.1 Implement GameState pretty printer and parser
    - `format(state: GameState): string` for human-readable output
    - `parse(text: string): GameState` to reconstruct from formatted text
    - _Requirements: 22.1, 22.2_

  - [ ]* 24.2 Write property test for pretty printer round-trip
    - **Property 39: Pretty Printer Round-Trip**
    - **Validates: Requirements 22.1, 22.2**

- [ ] 25. Implement Timer Service
  - [x] 25.1 Implement TimerService
    - Start 120-second countdown per player decision
    - Auto-resolve on timeout using default behavior
    - Display remaining time to all players
    - Cancel timer when decision received
    - _Requirements: 23.1, 23.2, 23.3_

  - [ ]* 25.2 Write property test for timer auto-resolution
    - **Property 40: Timer Auto-Resolution**
    - **Validates: Requirements 23.1, 23.2**

- [x] 26. Implement Game Log
  - [x] 26.1 Implement game log system
    - Append timestamped entry for every game action with description and outcome
    - Display log in chronological order to all players
    - Retain complete log for game session duration
    - _Requirements: 24.1, 24.2, 24.3_

  - [ ]* 26.2 Write property test for game log integrity
    - **Property 41: Game Log Integrity**
    - **Validates: Requirements 24.1, 24.2, 24.3**

- [x] 27. Implement disconnection and reconnection handling
  - [x] 27.1 Implement disconnection/reconnection logic
    - Preserve disconnected player's state for 300 seconds
    - Restore full state on reconnection within window
    - Auto-resolve pending decisions for disconnected players (skip optional, no purchases)
    - Mark as abandoned after 300 seconds, continue game with remaining players
    - Notify all players on disconnect/reconnect events
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

  - [ ]* 27.2 Write property tests for disconnection handling
    - **Property 35: Disconnection/Reconnection State Preservation**
    - **Property 36: Disconnected Player Auto-Resolution**
    - **Property 37: Abandonment After Timeout**
    - **Validates: Requirements 20.1, 20.2, 20.3, 20.4**

- [x] 28. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 29. Implement REST API for lobby management
  - [x] 29.1 Implement REST endpoints
    - `POST /api/lobbies` — create lobby, return invite code
    - `POST /api/lobbies/join` — join by invite code
    - `POST /api/lobbies/:lobbyId/start` — start game (validate 2–4 players)
    - Wire to lobby management logic from task 4
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [x] 30. Implement WebSocket Gateway
  - [x] 30.1 Implement WebSocket gateway
    - Manage persistent connections per player per game
    - Route `ClientMessage` to GameEngine
    - Broadcast `ServerMessage` (state updates, phase changes, log entries, errors) to connected clients
    - Filter state by visibility before sending (public vs private)
    - Handle heartbeat for connection monitoring
    - _Requirements: 19.1, 19.4, 25.1, 25.2_

- [x] 31. Implement React client application
  - [x] 31.1 Implement lobby UI
    - Create/join lobby screens with invite code input
    - Display connected players list
    - Host start game button (disabled when < 2 players)
    - _Requirements: 1.1, 1.2, 1.5, 1.6_

  - [x] 31.2 Implement city selection UI
    - Display available city cards with abilities and starting values
    - City selection with visual feedback for taken cities
    - Countdown timer display for selection timeout
    - _Requirements: 2.1, 2.2, 26.3_

  - [x] 31.3 Implement main game board UI
    - Player city board with track levels, resources, abilities
    - Public info display for all players (tracks, troops, card counts, VP)
    - Private info display for current player (coins, citizens, knowledge tokens, dice, cards)
    - Current event card display
    - Politics card market display
    - Achievement tokens display
    - Phase indicator and round counter
    - _Requirements: 19.2, 19.3, 28.3, 4.2, 26.3_

  - [x] 31.4 Implement phase interaction UIs
    - Dice phase: dice display, action selection dropdowns, citizen cost indicator, assign button
    - Action phase: action-specific choice UIs (card selection, track advancement, purchase confirmation)
    - Progress phase: track advancement controls with citizen cost display
    - Achievement phase: claimable achievement display
    - _Requirements: 6.3, 6.5, 12.1, 13.1, 15.1, 17.2_

  - [x] 31.5 Implement notifications, timer, and game log UI
    - Visual notification when player must make a decision
    - Display pending player name and action to all others
    - Countdown timer visible to all players
    - Scrollable game log in chronological order
    - _Requirements: 23.1, 23.3, 24.2, 25.1, 25.2_

  - [x] 31.6 Implement end-of-game summary screen
    - Final scoreboard with VP breakdown by category per player
    - Highlight winning player
    - Access to complete game log from summary
    - _Requirements: 18.5, 29.1, 29.2, 29.3_

- [x] 32. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 33. Integration wiring and end-to-end validation
  - [x] 33.1 Wire full game loop end-to-end
    - Connect REST API → Lobby → WebSocket → GameEngine → StateMachine → PhaseManagers → ActionResolvers → ScoringEngine → PersistenceLayer
    - Verify a complete 9-round game can be played through the system
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 33.2 Write integration tests for full game flow
    - Test complete lobby → city selection → 9 rounds → final scoring flow
    - Test disconnection/reconnection mid-game
    - Test timer expiration and auto-resolution
    - _Requirements: 3.1, 3.4, 20.1, 20.2, 23.2_

- [x] 34. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout development
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Run tests with `npx vitest --run`
