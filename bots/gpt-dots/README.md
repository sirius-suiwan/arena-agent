# GPT-dots

An independent Tank Trouble bot written for Arena Agent. It supports two to eight seats and reads only the information supplied through the common bot protocol. The directory does not include or depend on the Laika policy.

```sh
node apps/cli/arena.js run --seed 12 --score-to-win 1 \
  --bot-a gpt-dots --bot-b laika
```

- **Dodging comes first.** It predicts short bouncing projectile trajectories and compares nine possible drive/turn actions. If its intended move would be threatened, it can drop its shot to dodge; it also checks nearby armed mines.
- **Aim for a viable shot.** It traces the current barrel heading and several direct and mirror-bank angles, rejecting paths predicted to return to its tank. Its firing behavior accounts for held-input and fresh-press weapons.
- **Keep moving.** It uses a grid route to reach opponents, favor nearby special weapons, retreat from nearby opponents at a full shell cap, and recover from blocked movement.

All search loops have fixed bounds and all tie breaks are deterministic. This is a local geometric heuristic, not a perfect forward simulator: predictions approximate wall endpoints, treat opponents as stationary during the shot estimate, and cannot anticipate new inputs or weapons. A single match is not a strength benchmark.
