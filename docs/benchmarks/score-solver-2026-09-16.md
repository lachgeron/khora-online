# Score solver evaluation — 16 September 2026

## Method

The opening harness starts immediately before assigning round-one dice. It uses each city's actual starting resources and first development, seeded shuffled five-card hands and future dice, the full central board, and a fixed valid event sequence. Hands are synthetic deals, not optimized drafts or the user's captured position.

The arena plays complete games and replans at every local decision. Opponents use the frozen `reference-evaluation.ts` policy, with legal choices validated by the actual engine. The measured objective is the local player's actual final points, not winning margin. Search uses a wall-clock budget, so results can vary with machine load and completed trial count. Experiments ran sequentially on the development machine.

## Two-player tuning set

Each search receives 200ms per local decision. Opponents use the balanced reference policy. The pre-optimization baseline already includes the earlier improvements to dice enumeration and full-path learning. These six games were used to select the new search settings, so they are not held-out evidence.

| City / deal | Reference policy only | Pre-optimization search | Revised search |
| --- | ---: | ---: | ---: |
| Athens / 4 | 51 | 65 | 72 |
| Athens / 5 | 49 | 51 | 81 |
| Sparta / 4 | 34 | 59 | 66 |
| Sparta / 5 | 23 | 50 | 73 |
| Thebes / 4 | 39 | 52 | 67 |
| Thebes / 5 | 52 | 62 | 72 |
| Mean | 41.3 | 56.5 | 71.8 |

The revised search produced a legal recommendation at every tested decision, with no arena fallback. Its largest observed decision duration in these games was 223ms. This is not a browser or low-end-device latency guarantee.

## Four-player holdout

These city/deal/player-count combinations were not used to select settings. Search receives 500ms per local decision; the three opponents use the military-focused reference policy. The reference-only column uses the balanced policy for the local player against those same opponents. It is a comparison against a simple policy, not against the old search with an equal budget.

| City / deal | Reference policy only | Revised search |
| --- | ---: | ---: |
| Athens / 6 | 38 | 79 |
| Corinth / 6 | 44 | 63 |
| Miletus / 6 | 50 | 69 |
| Argos / 6 | 33 | 40 |
| Mean | 41.3 | 62.8 |

All four games completed without fallback or illegal moves. The largest observed decision duration was 540ms. Argos remains substantially weaker than Athens in this sample; the results do not establish uniform strength across cities or deals.

## Performance and rejected experiments

The current 30-second Athens opening projections for deals 1, 2, and 3 were 82, 68, and 82, after 1,098, 1,198, and 1,298 completed trials. The first full plans arrived in 81ms, 85ms, and 79ms. An earlier search revision projected 65, 82, and 77 on those deals. The uneven changes are why actual-game comparisons take precedence over maximizing the displayed number: better opponent continuations can lower a conditional projection.

A five-second CPU profile of Athens deal 4 processed 15,020 simulated moves before the simulation optimizations, 51,200 after caching the deterministic clock seed, and 83,653 after compacting immutable asset definitions in state keys. The first full continuation arrived after 214ms, 130ms, and 103ms respectively. Profiling changes timing; these are throughput measurements, not direct measures of playing strength.

The accepted search caches repeated evaluations, initially expands eight ranked rollout choices, progressively widens visited positions, searches optional activation windows, and stops revisiting completely evaluated endings. Every legal candidate is still eligible for later expansion.

Several plausible changes were rejected using the six-game tuning set:

- Evaluating all within-turn action combinations averaged 58.5 points and lost most of the speed improvement.
- Running that combination evaluator as an occasional fifth rollout policy averaged 63.2.
- Selecting exploration branches by their best stored continuation instead of their sample mean averaged 63.0.
- A cheap Philosophy funding bonus averaged 73.0, but was uneven (Athens deal 4 fell from 72 to 64 and Thebes deal 5 from 72 to 62). That small average gain was not sufficient evidence to retain the additional heuristic.
- Combining that funding bonus with strategy-specific ordering of newly visited rollout positions averaged 65.2.

The accepted narrower rollout search averaged 71.8. These comparisons are small samples and should guide further testing, not be read as general algorithm rankings.

## Reproduction and limits

Run from the repository root:

```text
node --import tsx packages/server/src/score-solver/arena.ts 200 4,5 athens,sparta,thebes
node --import tsx packages/server/src/score-solver/arena.ts 500 6 athens,corinth,miletus,argos 2 4
node --import tsx packages/server/src/score-solver/arena.ts 0 6 athens,corinth,miletus,argos 2 4
node --import tsx packages/server/src/score-solver/benchmark.ts athens 1 30000
```

Raw arena results and opening traces are retained in [the data file](score-solver-2026-09-16.json). The automated suite checks legal replay and exact displayed scores, snapshot identity, multiple cities and draft modes, expansion choices, optional activations, and an independently enumerated endgame. The solver is still approximate and its projected score depends on modeled opponent choices. Human-strength calibration and an optimality guarantee are not established by these tests.
