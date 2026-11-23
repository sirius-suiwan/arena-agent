# Laika（复刻）

A separate JSON Lines bot for Arena Agent. Entry point: `bots/laika/bot.js`. Its policy is an adaptation of [Killfield's Laika](https://github.com/Cichlider/killfield/blob/0ccc4ab15fa9888687e743574e0258260ee00e77/engine/src/laika.rs), pinned at `0ccc4ab15fa9888687e743574e0258260ee00e77`. The [upstream MIT license and its scope](https://github.com/Cichlider/killfield/blob/0ccc4ab15fa9888687e743574e0258260ee00e77/LICENSE) are reproduced in [LICENSE](LICENSE).

The port adapts goal competition with incumbent decay, aggression budget, short-range chase and low-ammo retreat, wall recovery, and incoming-trajectory checks. It uses Arena Agent's observed grid, projectile velocities, own ammo, and weapon fields; no access to hidden engine state. Shallow geometric shot prediction, a fixed candidate fan, deterministic goal tie breaking and a bounded avoidance search replace upstream game-specific geometry, randomness and action stack. It deliberately does not reproduce historical implementation bugs. It is neither the original Sublab AI nor a bit-for-bit port of the Killfield bot, and no original Tank Trouble source or assets are included.

```sh
node apps/cli/arena.js run --seed 12 --score-to-win 1 \
  --bot-a bots/laika/bot.js --bot-b bots/examples/turret.js
```
