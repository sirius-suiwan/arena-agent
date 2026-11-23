# GPT-dots

An independent Tank Trouble bot written for Arena Agent. It supports two to eight seats and reads only the information supplied through the common bot protocol. The directory does not include or depend on the Laika policy.

```sh
node apps/cli/arena.js run --seed 12 --score-to-win 1 \
  --bot-a gpt-dots --bot-b laika
```

- **Dodging comes first.** It predicts bouncing projectile paths including rounded wall ends. When its regular motion predicts a hit, it searches several short sequences of drive/turn actions, retaining five candidates per stage for roughly half a second of lookahead. If its intended move would be threatened, it can drop its shot to dodge; it also checks nearby armed mines.
- **Aim for a viable shot.** It traces the current barrel heading and several direct and mirror-bank angles, rejecting paths predicted to return to its tank. At close range it can fire from the next legal movement/turn without giving up a crate route. Aim attempts have a tick budget to avoid stationary waits. Its firing behavior accounts for held-input and fresh-press weapons.
- **Keep moving.** It routes to a reachable crate first when its weapon slot is empty (unless dodging or already aligned on a short clean shot). It uses grid paths to reach opponents, rounds obstructed openings from the cell center, retreats near opponents at a full shell cap, and chooses a short viable escape trajectory after a stall.

When the rules provide a shrinking safe rectangle, it estimates maze travel time, heads for a safe reachable cell before the boundary reaches it, and skips unsafe pickups. Immediate projectile avoidance still controls each action.

Classic reads the effective movement, projectile and tick profile from each observation. It releases between regular shots, respects the configured live-shell limit, holds a started Gatling burst through ammunition depletion unless evading, and steers RC missiles through the ordinary turn input. With the current laser profile it models straight travel before the first interior-wall crossing, then the clockwise arc, for both aiming and dodging. Missing or invalid profiles produce a neutral action.

All search loops have fixed bounds and all tie breaks are deterministic. This is a local geometric heuristic, not a perfect forward simulator: shot selection approximates some wall contacts, treats opponents as stationary during the shot estimate, and cannot anticipate new inputs or weapons. A single match is not a strength benchmark.
