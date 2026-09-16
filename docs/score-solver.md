# Live score solver

## Agreed behavior

- Maximize the local player's final points. Score margin and winning probability are not the objective.
- Use the complete authoritative position: every hand, deck order, event order, dice schedule, hidden simultaneous submissions, and expansion choices.
- Cover city selection, both draft modes, dice/scroll allocation, all seven actions and their choices, progress combinations, achievements, events, expansion choices, and activatable city developments.
- Show the immediate recommendation and a conditional continuation to final scoring. Recalculate after actual choices or other state changes.
- Model each opponent as trying to maximize their own final points.
- Remain usable during live turn timers. Recommendations never submit moves automatically.

## Search strategy

An explicit snapshot request supplies full information only when the panel is open. A dedicated browser worker executes the existing game engine and scoring code, leaving the server's turn loop and browser's controls free to respond.

Search combines a multiplayer Monte Carlo tree with deterministic max-n continuation backups. Each acting player selects according to their own final points. Legal branches enter progressively; action ordering uses real action effects, while varied rollout policies explore culture, military, and development investments. Completed simulations, rather than heuristic values, supply displayed scores. The displayed path is retained alongside its actual terminal scores; it is conditional on predicted opponent actions, not a guaranteed result.

Equivalent dice permutations are merged only when their action sets, total citizen costs, and scroll spending match. Distinct action sets are considered before alternate allocations. All decisions along completed trials learn from their results, and alternate iterations improve later decisions in the retained plan. A bounded LRU cache continues accepting new positions after reaching capacity. Stored scored continuations survive eviction; the next acting player's own score selects between competing suffixes. Estimates can fall when stronger opponent continuations are discovered.

Rollouts initially expand eight ranked choices and widen as a position is revisited. Ranking considers every candidate before choosing which ones to simulate. This is not a permanent eight-choice cutoff. Completely evaluated subtrees are marked solved and no longer consume exploration; a fully evaluated root finishes early and can be reused immediately. Optional city abilities have their own pass branch, including windows while another player has a pending choice.

Simulation caches the deterministic clock/random seed per immutable position, instead of repeatedly serializing the whole game for every clock read. Position keys compact official card, city, event, and achievement definitions while retaining dynamic and hidden information. Modified asset definitions retain their content. Position evaluation is also cached by immutable state. These caches are worker-local and weakly held where possible.

Work yields in approximately 12ms slices, publishes progress roughly every 150ms, and stops two seconds before the current decision deadline (up to 30 seconds per position). With almost no time left, it uses a short 50ms attempt. Matching positions can reuse search data; changed snapshot requests invalidate earlier results. Closing the panel or losing the connection stops the worker.

Future city offers and the initial politics draft shuffle are generated on demand by the live game. They do not yet exist in the authoritative state during city selection. Simulation assumes reproducible draws and explicitly labels that limitation. Already determined cards, events and dice are used exactly.

The interface always says that optimality is unproven. Playing strength has been measured on synthetic positions, not calibrated against expert human opponents or captured live games. It does not enumerate every possible continuation within a live timer, infer an opponent's personal tendencies, or guarantee opponents choose the projected moves.

## Deployment

The Vercel client and Fly game server must both be deployed for this feature. The client requests `SOLVER_SNAPSHOT_REQUEST`; older servers cannot provide the full position. If no matching snapshot arrives within five seconds, the panel reports the missing response instead of waiting indefinitely. Refresh retries the request.

From the repository root, sign in with `fly auth login` and deploy with `fly deploy --app khora-server`. Deploy between games: active game state is held in server memory and does not survive a server restart. Deploy the client through its existing Vercel workflow.

## Validation

Tests verify snapshot function restoration, position identity, immutability, reproducible transitions, score-only selection for every acting player, a known endgame choice, optional final development activations, expansion choice kinds, progress combinations, both draft modes, and four-player continuations for all seven cities. Complete projected paths are replayed through the engine and their final scores checked. Timing tests exercise first results and full-path generation on the development machine; browser and device speeds vary.

An independently enumerated endgame verifies both the final score and search termination. A second snapshot of that solved position must reuse its result without further trials. Other regressions check same-ID modified assets and anytime activation while another player is deciding.

The opening benchmark runs with `node --import tsx packages/server/src/score-solver/benchmark.ts athens 1 30000` (city, deal seed, milliseconds). It uses real starting resources, a fixed valid five-card hand per player, seeded dice, the full central board, and fixed events. These are reproducible synthetic deals, not captured user games or optimized drafts.

In development-machine runs with a 30-second budget, the original solver's terminal projections for Athens deals 1, 2, and 3 were 48, 50, and 48; an earlier search revision returned 65, 82, and 77, and the current revision returned 82, 68, and 82. The gains are uneven, and the middle deal's projection fell as opponent continuations changed. These compare conditional projected plans, not actual match outcomes against a fixed opponent or proof of optimality. Timing and final results vary with completed trial count. Regression tests replay retained plans at multiple search checkpoints and check their scores, plus early discovery of valuable cards beyond the old eight-choice cutoff.

The full-game arena measures actual final scores against a separately frozen heuristic opponent. Run `node --import tsx packages/server/src/score-solver/arena.ts 200 4,5 athens,sparta,thebes` (milliseconds per local decision, comma-separated seeds, cities, opponent strategy 0–3, player count 2–4). A zero time budget uses the frozen balanced policy for the local player. The arena replans throughout the game and validates every chosen move through the engine. This differs from merely maximizing a projected continuation against changing simulated opponents.

On the six two-player tuning games above, the pre-optimization search averaged 56.5 actual final points; the revised search averaged 71.8 at the same 200ms decision budget. A five-second profile processed 15,020 simulated moves before the simulation optimizations and 83,653 after them. These small, machine-dependent samples demonstrate an improvement, not a universal score increase or an optimality claim. Detailed runs, holdouts, and rejected experiments are recorded in [the benchmark report](benchmarks/score-solver-2026-09-16.md).

Search changes are bundled into the client worker: deploy the Vercel client to use them. A Fly deployment is only needed when the snapshot protocol or game-server code also changes.
