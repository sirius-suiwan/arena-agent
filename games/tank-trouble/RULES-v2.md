# 坦克动荡：游戏规则与 Bot 速查（v2）

1. 两到三辆坦克在随机迷宫对战，普通弹可反弹、可打死自己；一发命中即击毁。每辆坦克最多同时有五枚普通弹，7.5 个游戏秒后消失。
2. 只剩一辆坦克时还要撑过 3 秒，期间场上弹丸和地雷仍会伤人。活到最后才加一分；同归于尽不加分。每小局更换迷宫，默认先拿三分者获胜。
3. 每游戏秒 60 tick。每 tick 一条动作：`throttle` 和 `turn` 都取 -1/0/1，`fire` 为布尔值。角度以弧度计，0 向右，顺时针为正。按住开火与重新按下不是一回事，使用地雷和手动引爆时尤其重要。
4. 黑色道具箱会替换当前普通武器一次；手上已有武器时不能再拿。具体武器的充能、发射、引爆和命中顺序见下方。
5. `tick` 是整场计数，`roundTick` 每小局重置；弹丸、地雷、道具的实体 ID 只在各小局内唯一。复盘请用小局号和 ID 一起追踪。

下方列的是本项目的准确参数，不代表 4399 原版所有数值都已考证。

The old 4399 maze game is the reference, not the Flash runtime or assets. This is an independent, deterministic reconstruction. The original [4399 entry](https://www.4399.com/flash/137953.htm) confirms solo/dual/triple play and the expanded arsenal; the [4399 test-version play guide](https://a.4399.cn/gg/39315180_263349.html) describes bounce, self-kills, randomized maps and crates, and a delay before scoring the last survivor. The [historical Chinese community description](https://www.newton.com.tw/wiki/%E5%9D%A6%E5%85%8B%E5%8B%95%E7%9B%AA2) gives five live ordinary shells, approximate 7–8-second shell life, and several familiar weapon effects. An [archived 2013 weapons guide](https://tanktrouble-archive.fandom.com/wiki/Weapons) describes the separate reflective Laser and its preview. Those sources do not establish exact engine constants. The parameters below define this arena, not claims about original Flash code. For earlier arena logs, see [v1 rules](RULES-v1.md).

## Reading the observation and issuing actions

- The simulated clock runs at **60 ticks per game second**. All bots act on the same tick N; accepted actions determine state N+1. Game time is independent of UI and hardware speed.
- Submit exactly one action payload: `{"throttle":1,"turn":-1,"fire":false}`. Throttle −1/0/+1 reverses, stops, or advances. Turn −1/0/+1 turns counterclockwise, stays, or turns clockwise. `fire` is the pressed state for **this tick**. A new press after release matters for frag and mines. A neutral action is all zero/false. No mouse coordinates or keycodes are accepted over the bot protocol.
- Observation includes the receiving `playerId`, current tick, arena width/height, full `walls`, all `tanks`, `bullets`, `pickups`, `mines`, remaining settlement deadline where present, and result where present. Coordinates are in pixels, right = +x, down = +y. Angle 0 points right; angle increases clockwise in radians.
- Tank fields include `alive`, `cooldown`, `weapon`, `weaponAmmo`, `weaponCharge`, `weaponGap`, `fireHeld`, `fragId`, and `aimAngle`. Projectile fields include `owner`, `kind`, `sourceId`, position, velocity (px/tick), `ttl` (advances remaining), and whether it can hit its owner. Track projectiles, mines and crates by their IDs within the round. For fairness/debugging the full-state bot interface reveals even dormant mines; this differs from human visibility. Internal RNG state/counters are not in bot observations.

## Round and movement

- Two or three tanks start in seeded opposite corners (two) or three distinct seeded corners. Each round generates a connected maze with seeded loop openings. Cells are 64 px square, walls are axis-aligned line segments. No wall destruction.
- Movement order: rotate 0.06 rad/tick, then move up to 2.2 px/tick in that direction. Tank collision radius is 12 px. Wall penetration cancels travel but not rotation. Overlapping candidate tank positions cancel both moves, repeating conflict checks after rewinds. A tank cannot kill by pushing in this reconstruction.
- A surviving tank may keep acting for 180 ticks (3 simulation seconds) after becoming the sole survivor. Existing projectiles and mines stay live. If no tanks remain before scoring, no one scores; if the lone tank survives through its settlement tick, it wins. More than one survivor at `maxTicks` draws. No new crates or pickups resolve during settlement. No respawn inside a round.

## Shells and weapons

- One hit destroys a tank. Ordinary shells travel 6 px/tick, have 3 px collision radius, and ricochet off walls and wall endpoints. Exactly simultaneous corner contact reverses components; a wall contact ties ahead of a tank hit. The owner is protected only until the shell exits the initial hull radius or bounces. Shells do not collide with one another. Max **five live ordinary shells per tank**; slot opens on hit/expiration. Normal cooldown is 24 ticks and each shell expires after 450 ticks (7.5s), including its launch advance.
- Crates spawn at unoccupied cell centers at least 30 px from living tanks, every 360 ticks by default, up to four present. Drive within 20 px to equip. You cannot replace a held weapon. Closest eligible tank wins a race; exact ties are seeded, not process-order races. The crate type is chosen from the following five weapons:
  - **Laser / 瞄准激光** (`laser`): a dotted, walls-only `aimGuide` previews up to 256 px. A fresh press consumes the pickup and fires an instantaneous lethal ray, reflecting off walls and stopping at the first tank, 576 px or 16 segments, whichever ends the path first. It may hit its owner after a bounce. It reserves no shell slot. The preview ignores tanks; it is not a guarantee of a hit.
  - **Death Ray** (`death-ray`): hold fire for 90 ticks. Hull and aim lock while holding the charge. Release cancels the charge without consuming the weapon. At full charge a single lethal ray passes through walls and can hit multiple opponents. The tank returns to normal fire after use. This is the through-wall weapon, not the separate classic targeting-laser pickup.
  - **Gatling** (`gatling`): hold fire for 18 charge ticks; emit 18 small shells, one every 5 held/ready ticks at 7.5 px/tick. Releasing fire pauses firing, preserving charge/ammo. The deterministic fan varies aim by up to 0.045 rad. Shell life is 90 ticks. They ricochet, can injure their owner, and do not use normal shell slots.
  - **Mines** (`mine`): up to three placements behind the hull, one per fresh press. Arm 30 ticks after placement. A nearby tank within 18 px triggers the armed mine; the owner can trigger it only after moving more than 20 px away. Blast emits 12 shrapnel shells with stable source IDs.
  - **Frag bomb** (`frag`): one fresh press launches a bouncing bomb at 4.5 px/tick. Another fresh press detonates it; impact or 240-tick expiry also detonates it. The bomb itself can hit. The blast emits 16 shrapnel shells. A dead owner cannot manually detonate, but the existing projectile remains live.
- Shrapnel first moves the following tick; it bounces, travels at 5 px/tick, and lasts 60 advances. It can hit the tank that created it. Special-weapon ammunition does not count against the regular five-shell cap.
- Within each tick: move tanks, fire weapons, trace projectile movement, trigger mines, create burst fragments, then resolve impacts and round status, then collect/spawn crates when applicable. A fired weapon or projectile survives a same-tick owner death. Hits are gathered against the same pre-damage tank state, so simultaneous deaths are possible. Same-time tank hit ties are resolved in stable seat order. Logs contain shot, bounce, hit, destruction, expiry, crate, and weapon/burst events with stable within-round IDs.

Config bounds are in [config-v2.json](schema/config-v2.json); the [action schema](schema/action-v2.json) describes only the game payload, not its transport envelope. RC missile, homing missile, exact original maze distribution and tuning, Flash UI input behavior, and collision-based kills are not implemented. For deterministic re-simulation, use the same implementation, runtime, config, player order, seed, and accepted action stream.

## Match wrapper and replay

- Default match: the first tank to **three round wins**. A draw awards no point; the score persists across rounds. After an unresolved series round ends, the last frame stays for 60 ticks before the next seeded maze. These scoring and safety limits are this platform's match format, not a claim about when Flash stopped play.
- `tick` is the global match clock; `roundTick` resets at each new maze, `round` starts at 1, and `scores` is keyed by seat. `phase` is `playing` or `intermission` in observations; actions during intermission have no effect. `settleUntil` is relative to `roundTick`. Use both `round` and entity ID to link events across a match.
- The CLI can override the score target with `--score-to-win 1` (range 1–10). There is a host tick limit; hitting it before the target ends with no match winner. This limit is separate from the round `maxTicks`.
- Human controls: A uses arrow keys and M (or Space); B uses ESDF and Q; in three-human play, C moves the mouse and clicks the arena. All of these are translated into the same accepted action payload as a bot.
