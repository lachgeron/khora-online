# Requirements Document

## Introduction

This document defines the requirements for an online multiplayer implementation of the board game "Khora: Rise of an Empire." The application allows 2–4 players to play the full game over the internet in real time. Each player develops a Greek city-state over 9 rounds by rolling dice, selecting actions, managing resources, and competing across economy, culture, and military tracks. The implementation must faithfully reproduce the board game's rules, phases, and victory-point scoring.

## Glossary

- **Game**: A single session of Khora: Rise of an Empire played by 2–4 players over 9 rounds.
- **Player**: A human participant controlling one City.
- **City**: A player's city-state board, defined by a unique starting card with asymmetric abilities, containing tracks for Economy, Culture, and Military, plus resource pools.
- **Round**: One of the 9 sequential turns in a Game, each consisting of seven ordered Phases.
- **Phase**: A distinct step within a Round. The seven Phases in order are: Omen, Taxation, Dice, Actions, Progress, Glory, Achievement.
- **Omen_Phase**: The first Phase of each Round, where an Event card is revealed that applies a global effect.
- **Taxation_Phase**: The second Phase, where each Player collects Tax (coins) and Population (citizens) based on their Economy and Culture track levels.
- **Dice_Phase**: The third Phase, where each Player rolls two dice privately and assigns one die to each of their two chosen Action slots.
- **Action_Phase**: The fourth Phase, where Players resolve their two chosen Actions in ascending order of action number across all Players.
- **Progress_Phase**: The fifth Phase, where Players may advance on one or more tracks (Economy, Culture, Military) by spending Citizens.
- **Glory_Phase**: The sixth Phase, where Players gain Glory points based on the current Round's Event card conditions.
- **Achievement_Phase**: The seventh Phase, where Players may claim Achievement tokens if they meet the printed conditions.
- **Action**: One of seven possible activities a Player can perform: Philosophy (1), Legislation (2), Culture (3), Trade (4), Military (5), Politics (6), Development (7).
- **Die_Value**: The face value of a rolled die (1–6), used to determine if an Action can be performed for free or requires spending a Citizen.
- **Citizen**: A resource representing population, used to boost dice, pay for actions, and advance on tracks.
- **Coin**: The monetary resource (Drachma), used to pay for Politics cards, Development tiles, and other costs.
- **Knowledge_Token**: A resource gained through Philosophy, used to purchase Knowledge cards or trigger special abilities.
- **Troop**: A military unit token gained through the Military action, used for military comparisons and Glory scoring.
- **Politics_Card**: A card purchased during the Politics action that grants ongoing abilities, end-game scoring, or one-time effects.
- **Decree**: A law card gained through the Legislation action that provides ongoing benefits or scoring conditions.
- **Achievement_Token**: A token claimed during the Achievement Phase when a Player meets specific conditions, worth victory points.
- **Event_Card**: A card revealed during the Omen Phase that defines the round's global effect, Glory conditions, and sometimes penalties.
- **Economy_Track**: A track on the City board (levels 0–7) that determines Tax income in coins.
- **Culture_Track**: A track on the City board (levels 0–7) that determines Population income in citizens.
- **Military_Track**: A track on the City board (levels 0–7) that determines military strength for comparisons.
- **Victory_Points**: The scoring metric that determines the winner. Accumulated from Glory, Achievements, Politics cards, Decrees, track levels, and other sources.
- **Lobby**: A virtual waiting room where Players gather before a Game starts.
- **Host**: The Player who creates a Lobby and can start the Game.
- **Game_State**: The complete serialized representation of all game data at any point in time.
- **Action_Slot**: One of two slots a Player uses to assign a die and select an Action each Round.

## Requirements

### Requirement 1: Lobby Creation and Player Management

**User Story:** As a Player, I want to create or join a game lobby, so that I can play Khora online with my friends.

#### Acceptance Criteria

1. WHEN a Player creates a Lobby, THE Game SHALL generate a unique shareable invite code for that Lobby.
2. WHEN a Player provides a valid invite code, THE Game SHALL add that Player to the corresponding Lobby.
3. WHILE a Lobby has fewer than 2 Players, THE Game SHALL prevent the Host from starting the Game.
4. WHILE a Lobby has 4 Players, THE Game SHALL reject additional join requests with a message indicating the Lobby is full.
5. WHEN the Host selects "Start Game," THE Game SHALL transition all Players in the Lobby into a new Game session.
6. THE Game SHALL display the list of currently connected Players in the Lobby to all Lobby participants.
7. IF a Player disconnects from the Lobby before the Game starts, THEN THE Game SHALL remove that Player from the Lobby and notify remaining Players.

### Requirement 2: City Selection

**User Story:** As a Player, I want to choose my city-state, so that I can play with unique starting abilities.

#### Acceptance Criteria

1. WHEN the Game session begins, THE Game SHALL present each Player with the available City cards to choose from.
2. THE Game SHALL prevent two Players from selecting the same City in a single Game.
3. WHEN all Players have selected a City, THE Game SHALL initialize each Player's City board with the starting resources, track levels, and abilities defined on that City card.
4. IF a Player does not select a City within 120 seconds, THEN THE Game SHALL randomly assign an available City to that Player.

### Requirement 3: Round Structure

**User Story:** As a Player, I want the game to follow the correct round structure, so that gameplay matches the board game rules.

#### Acceptance Criteria

1. THE Game SHALL execute exactly 9 Rounds per Game.
2. THE Game SHALL execute the seven Phases within each Round in this fixed order: Omen, Taxation, Dice, Actions, Progress, Glory, Achievement.
3. WHEN all seven Phases of a Round are complete, THE Game SHALL advance to the next Round.
4. WHEN the ninth Round's Achievement Phase is complete, THE Game SHALL proceed to final scoring.

### Requirement 4: Omen Phase

**User Story:** As a Player, I want an Event card revealed each round, so that the round has unique conditions and Glory objectives.

#### Acceptance Criteria

1. WHEN the Omen Phase begins, THE Game SHALL reveal the top Event card from the Event deck.
2. THE Game SHALL display the revealed Event card's effects, Glory conditions, and any penalties to all Players.
3. THE Game SHALL apply any immediate global effects specified by the Event card.
4. THE Game SHALL use a pre-shuffled deck of Event cards so that each Game has a different sequence of Events.

### Requirement 5: Taxation Phase

**User Story:** As a Player, I want to collect income each round, so that I have resources to spend on actions.

#### Acceptance Criteria

1. WHEN the Taxation Phase begins, THE Game SHALL grant each Player Coins equal to the Tax value at their current Economy Track level.
2. WHEN the Taxation Phase begins, THE Game SHALL grant each Player Citizens equal to the Population value at their current Culture Track level.
3. THE Game SHALL apply any City-specific or Politics card modifiers to Taxation income before distributing resources.
4. THE Game SHALL display each Player's updated resource totals after Taxation.

### Requirement 6: Dice Phase

**User Story:** As a Player, I want to roll dice and assign them to actions, so that I can plan my strategy each round.

#### Acceptance Criteria

1. WHEN the Dice Phase begins, THE Game SHALL roll two six-sided dice for each Player using a server-side random number generator.
2. THE Game SHALL display each Player's own dice results only to that Player during the Dice Phase.
3. WHEN a Player has rolled dice, THE Game SHALL prompt the Player to select two different Actions and assign one die to each Action Slot.
4. THE Game SHALL prevent a Player from selecting the same Action for both Action Slots in a single Round.
5. IF a Player's assigned Die Value is less than the Action's number, THEN THE Game SHALL require the Player to spend Citizens equal to the difference to perform that Action, or forfeit the Action.
6. WHEN all Players have assigned their dice, THE Game SHALL proceed to the Action Phase.
7. IF a Player does not assign dice within 120 seconds, THEN THE Game SHALL randomly assign the dice to two available Actions for that Player.

### Requirement 7: Action Phase — Philosophy (Action 1)

**User Story:** As a Player, I want to perform the Philosophy action, so that I can gain Knowledge tokens.

#### Acceptance Criteria

1. WHEN a Player performs the Philosophy Action, THE Game SHALL grant that Player Knowledge Tokens as defined by the action's rules.
2. THE Game SHALL allow the Player to spend Knowledge Tokens on available Knowledge card effects during the Philosophy Action resolution.

### Requirement 8: Action Phase — Legislation (Action 2)

**User Story:** As a Player, I want to perform the Legislation action, so that I can gain Decree cards for ongoing benefits.

#### Acceptance Criteria

1. WHEN a Player performs the Legislation Action, THE Game SHALL allow that Player to draft a Decree card from the available Decree options.
2. THE Game SHALL apply the Decree's ongoing effect to the Player immediately upon drafting.
3. THE Game SHALL limit each Player to a maximum number of Decrees as defined by the game rules.

### Requirement 9: Action Phase — Culture (Action 3)

**User Story:** As a Player, I want to perform the Culture action, so that I can gain Victory Points and advance culturally.

#### Acceptance Criteria

1. WHEN a Player performs the Culture Action, THE Game SHALL grant that Player Victory Points as defined by the Culture action rules and the Player's current Culture Track level.

### Requirement 10: Action Phase — Trade (Action 4)

**User Story:** As a Player, I want to perform the Trade action, so that I can gain Coins and other resources.

#### Acceptance Criteria

1. WHEN a Player performs the Trade Action, THE Game SHALL grant that Player Coins as defined by the Trade action rules and the Player's current Economy Track level.
2. THE Game SHALL apply any Trade-related bonuses from Politics cards or City abilities.

### Requirement 11: Action Phase — Military (Action 5)

**User Story:** As a Player, I want to perform the Military action, so that I can gain Troops and strengthen my army.

#### Acceptance Criteria

1. WHEN a Player performs the Military Action, THE Game SHALL grant that Player Troop tokens as defined by the Military action rules and the Player's current Military Track level.
2. THE Game SHALL update the Player's total Troop count and display it to all Players.

### Requirement 12: Action Phase — Politics (Action 6)

**User Story:** As a Player, I want to perform the Politics action, so that I can purchase Politics cards for special abilities and end-game scoring.

#### Acceptance Criteria

1. WHEN a Player performs the Politics Action, THE Game SHALL display the available Politics cards in the market.
2. THE Game SHALL allow the Player to purchase one Politics card by paying its Coin cost.
3. IF the Player does not have enough Coins to purchase any available Politics card, THEN THE Game SHALL inform the Player and skip the purchase.
4. WHEN a Politics card is purchased, THE Game SHALL apply any immediate effects and register any ongoing or end-game scoring effects.

### Requirement 13: Action Phase — Development (Action 7)

**User Story:** As a Player, I want to perform the Development action, so that I can advance my city's tracks.

#### Acceptance Criteria

1. WHEN a Player performs the Development Action, THE Game SHALL allow that Player to advance on one or more tracks (Economy, Culture, or Military) by spending the required resources.
2. THE Game SHALL enforce track advancement costs as defined by the game rules.
3. THE Game SHALL apply any bonuses triggered by reaching specific track levels.

### Requirement 14: Action Resolution Order

**User Story:** As a Player, I want actions to resolve in the correct order, so that gameplay is fair and follows the rules.

#### Acceptance Criteria

1. THE Game SHALL resolve all Players' Actions in ascending order of Action number (Philosophy first at 1, Development last at 7).
2. WHEN multiple Players have selected the same Action number, THE Game SHALL resolve those Players' Actions simultaneously.
3. THE Game SHALL wait for each Action's resolution to complete before proceeding to the next Action number.

### Requirement 15: Progress Phase

**User Story:** As a Player, I want to advance my city's tracks between actions, so that I can grow my city-state's capabilities.

#### Acceptance Criteria

1. WHEN the Progress Phase begins, THE Game SHALL allow each Player to advance on one or more tracks (Economy, Culture, Military) by spending Citizens.
2. THE Game SHALL enforce the Citizen cost for each track level advancement as defined by the game rules.
3. THE Game SHALL prevent a Player from advancing a track beyond its maximum level (level 7).
4. THE Game SHALL apply any bonuses triggered by reaching specific track levels during the Progress Phase.
5. WHEN all Players have completed or skipped their Progress Phase decisions, THE Game SHALL proceed to the Glory Phase.

### Requirement 16: Glory Phase

**User Story:** As a Player, I want to earn Glory points based on the round's Event card, so that I can score Victory Points throughout the game.

#### Acceptance Criteria

1. WHEN the Glory Phase begins, THE Game SHALL evaluate each Player against the current Event card's Glory conditions.
2. THE Game SHALL award Victory Points to each Player who meets the Glory conditions as specified on the Event card.
3. THE Game SHALL display the Glory points earned by each Player for the current Round.

### Requirement 17: Achievement Phase

**User Story:** As a Player, I want to claim Achievement tokens when I meet their conditions, so that I can earn bonus Victory Points.

#### Acceptance Criteria

1. WHEN the Achievement Phase begins, THE Game SHALL evaluate each Player against all unclaimed Achievement token conditions.
2. WHEN a Player meets the conditions of an unclaimed Achievement token, THE Game SHALL allow that Player to claim it.
3. THE Game SHALL prevent an Achievement token from being claimed by more than one Player.
4. WHEN multiple Players qualify for the same Achievement token in the same Round, THE Game SHALL award it to the Player with the higher Military Track level, with ties broken by total Troop count.

### Requirement 18: Final Scoring

**User Story:** As a Player, I want accurate final scoring, so that the winner is determined correctly.

#### Acceptance Criteria

1. WHEN the ninth Round is complete, THE Game SHALL calculate each Player's total Victory Points from all sources: Glory points, Achievement tokens, Politics card end-game effects, Decree scoring, track level bonuses, remaining resources, and Troop bonuses.
2. THE Game SHALL apply the standard conversion of remaining resources to Victory Points as defined by the game rules.
3. THE Game SHALL rank all Players by total Victory Points in descending order.
4. IF two or more Players have the same total Victory Points, THEN THE Game SHALL break the tie using the tiebreaker rules (most remaining Citizens, then most remaining Coins).
5. THE Game SHALL display a final scoreboard showing each Player's Victory Point breakdown by category.

### Requirement 19: Real-Time Game State Synchronization

**User Story:** As a Player, I want to see the game state update in real time, so that I always have accurate information.

#### Acceptance Criteria

1. WHEN any Player performs an action that changes the Game State, THE Game SHALL broadcast the updated Game State to all connected Players within 2 seconds.
2. THE Game SHALL display each Player's public information (track levels, Troop count, number of Politics cards, number of Decrees, Victory Points) to all Players at all times.
3. THE Game SHALL display each Player's private information (Coins, Citizens, Knowledge Tokens, hand details) only to that Player.
4. WHILE a Player is connected to a Game, THE Game SHALL maintain a persistent connection for real-time updates.

### Requirement 20: Disconnection and Reconnection Handling

**User Story:** As a Player, I want to reconnect to a game if I lose connection, so that I don't lose my progress.

#### Acceptance Criteria

1. IF a Player disconnects during a Game, THEN THE Game SHALL preserve that Player's Game State for at least 300 seconds.
2. WHEN a disconnected Player reconnects within 300 seconds, THE Game SHALL restore that Player to their current position in the Game with full Game State.
3. WHILE a Player is disconnected, THE Game SHALL auto-resolve that Player's pending decisions using default behavior (skip optional actions, make no purchases).
4. IF a Player does not reconnect within 300 seconds, THEN THE Game SHALL mark that Player as abandoned and continue the Game with remaining Players, auto-resolving the abandoned Player's turns.
5. THE Game SHALL notify all connected Players when a Player disconnects or reconnects.

### Requirement 21: Game State Serialization and Persistence

**User Story:** As a Player, I want the game state to be saved, so that the game can survive server issues.

#### Acceptance Criteria

1. THE Game SHALL serialize the complete Game State to a persistent store after each Phase completion.
2. THE Game SHALL serialize the Game State using a JSON format.
3. WHEN the Game State is loaded from persistence, THE Game SHALL deserialize it and restore the Game to the exact saved state.
4. FOR ALL valid Game State objects, serializing then deserializing SHALL produce an equivalent Game State object (round-trip property).

### Requirement 22: Game State Pretty Printer

**User Story:** As a developer, I want to format Game State objects as readable text, so that I can debug and inspect game state.

#### Acceptance Criteria

1. THE Pretty_Printer SHALL format Game State objects into human-readable structured text.
2. FOR ALL valid Game State objects, parsing the Pretty Printer output then printing again SHALL produce identical text output (round-trip property).

### Requirement 23: Turn Timer

**User Story:** As a Player, I want a turn timer, so that the game progresses at a reasonable pace.

#### Acceptance Criteria

1. WHEN a Player must make a decision, THE Game SHALL start a 120-second countdown timer visible to all Players.
2. WHEN the timer reaches 0 seconds, THE Game SHALL auto-resolve the pending decision using default behavior.
3. THE Game SHALL display the remaining time to the active Player and all other Players.

### Requirement 24: Game Log

**User Story:** As a Player, I want to see a log of all game actions, so that I can review what happened during the game.

#### Acceptance Criteria

1. WHEN any game action occurs, THE Game SHALL append a timestamped entry to the Game Log describing the action and its outcome.
2. THE Game SHALL display the Game Log to all Players in chronological order.
3. THE Game SHALL retain the complete Game Log for the duration of the Game session.

### Requirement 25: Player Notifications

**User Story:** As a Player, I want to receive notifications when it's my turn, so that I don't miss my actions.

#### Acceptance Criteria

1. WHEN a Player must make a decision, THE Game SHALL display a visual notification to that Player indicating the required action.
2. WHEN the Game is waiting for a specific Player, THE Game SHALL display that Player's name and the pending action to all other Players.

### Requirement 26: City Ability Enforcement

**User Story:** As a Player, I want my city's unique abilities to be applied correctly, so that asymmetric gameplay works as intended.

#### Acceptance Criteria

1. THE Game SHALL apply each City's unique starting ability as defined on the City card throughout the entire Game.
2. WHEN a City ability modifies a standard game rule, THE Game SHALL apply the modification consistently in all relevant Phases and Actions.
3. THE Game SHALL display each Player's active City abilities on their City board view.

### Requirement 27: Resource Validation

**User Story:** As a Player, I want the game to prevent illegal resource spending, so that the rules are enforced correctly.

#### Acceptance Criteria

1. WHEN a Player attempts to spend resources, THE Game SHALL verify that the Player has sufficient resources before executing the transaction.
2. IF a Player attempts to spend more resources than available, THEN THE Game SHALL reject the transaction and display an error message indicating insufficient resources.
3. THE Game SHALL prevent any Player's resource count from going below zero.

### Requirement 28: Politics Card Market

**User Story:** As a Player, I want a visible market of Politics cards, so that I can plan my purchases.

#### Acceptance Criteria

1. THE Game SHALL maintain a visible market of Politics cards available for purchase.
2. WHEN a Politics card is purchased from the market, THE Game SHALL replace it with a new card from the Politics deck.
3. THE Game SHALL display each Politics card's cost, type, and effect text to all Players.

### Requirement 29: End-of-Game Summary

**User Story:** As a Player, I want a detailed end-of-game summary, so that I can review the full game outcome.

#### Acceptance Criteria

1. WHEN the Game ends, THE Game SHALL display a summary screen showing each Player's final Victory Point total and breakdown.
2. THE Game SHALL highlight the winning Player on the summary screen.
3. THE Game SHALL allow Players to review the complete Game Log from the summary screen.
