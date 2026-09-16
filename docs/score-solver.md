# Live score solver

## Agreed behavior

- Maximize the local player's final points. Score margin and winning probability are not the objective.
- Use the complete authoritative position: every hand, deck order, event order, dice schedule, hidden simultaneous submissions, and expansion choices.
- Cover city selection, both draft modes, dice/scroll allocation, all seven actions and their choices, progress combinations, achievements, events, expansion choices, and activatable city developments.
- Show the immediate recommendation and a conditional continuation to final scoring. Recalculate after actual choices or other state changes.
- Model each opponent as trying to maximize their own final points.
- Remain usable during live turn timers. Recommendations never submit moves automatically.

## First implementation

An explicit snapshot request supplies full information only when the panel is open. A dedicated browser worker executes the existing game engine and scoring code, leaving the server's turn loop and browser's controls free to respond.

Search uses a multiplayer Monte Carlo tree. Each acting player selects according to their own score estimates. Legal branches enter progressively; heuristic move ordering and rollout policies give quick initial results. Completed simulations, rather than heuristic values, supply the tree's final-score statistics. The displayed score comes from a complete replayable continuation under the current policy. It is conditional on predicted opponent actions, not a guaranteed result.

Work yields in approximately 12ms slices, publishes progress roughly every 150ms, and stops two seconds before the current decision deadline (up to 30 seconds per position). With almost no time left, it uses a short 50ms attempt. Matching positions can reuse search data; changed snapshot requests invalidate earlier results. Closing the panel or losing the connection stops the worker.

Future city offers and the initial politics draft shuffle are generated on demand by the live game. They do not yet exist in the authoritative state during city selection. Simulation assumes reproducible draws and explicitly labels that limitation. Already determined cards, events and dice are used exactly.

The interface always says that optimality is unproven. This is a first playable implementation; playing strength requires further benchmarking against stronger searches and real positions. It does not enumerate every possible continuation within a live timer, infer an opponent's personal tendencies, or guarantee opponents choose the projected moves.

## Deployment

The Vercel client and Fly game server must both be deployed for this feature. The client requests `SOLVER_SNAPSHOT_REQUEST`; older servers cannot provide the full position. If no matching snapshot arrives within five seconds, the panel reports the missing response instead of waiting indefinitely. Refresh retries the request.

From the repository root, sign in with `fly auth login` and deploy with `fly deploy --app khora-server`. Deploy between games: active game state is held in server memory and does not survive a server restart. Deploy the client through its existing Vercel workflow.

## Validation

Tests verify snapshot function restoration, position identity, immutability, reproducible transitions, score-only selection for every acting player, a known endgame choice, optional final development activations, expansion choice kinds, progress combinations, both draft modes, and four-player continuations for all seven cities. Complete projected paths are replayed through the engine and their final scores checked. Timing tests exercise first results and full-path generation on the development machine; browser and device speeds vary.
