# Arena Agent

本地多游戏竞技场：编程 bot 和人类共用动作接口。首款游戏是按 4399 旧版重建的坦克迷宫对战。无需远程联机或向模型服务发请求。

## 工程结构

| 目录 | 责任 |
| --- | --- |
| `core/` | 通用裁判：固定 tick、选手和动作截止 |
| `protocol/` | bot、游戏及界面各自的接入契约 |
| `runners/`、`bots/` | 进程管理和选手示例 |
| `games/` | 每款游戏独立维护规则、验证、物理与画法 |
| `replay/`、`runs/` | 录制和验证代码；生成的数据不入库 |
| `viewer/`、`apps/cli/` | 浏览器界面与本地命令入口 |
| `tests/` | 单元、协议、可重放和接入测试 |

开发规范见 [AGENTS.md](AGENTS.md)。项目使用 Node.js 22+；Python bot 需要 Python 3。

## 快速开始

```sh
npm test
node apps/cli/arena.js run --seed 42 --bot-a laika --bot-b gpt-dots
node apps/cli/arena.js serve
```

CLI 输出本局目录。打开 [游戏选择页](http://127.0.0.1:8765/) 进入《坦克动荡 2》，或直接打开 [坦克菜单](http://127.0.0.1:8765/tank)。保留原有快捷模式；展开「自定义对局」可在 A–H 之间任选 2–8 个席位。每席可用已注册 bot、真人或留空。三套真人控制各限一席：方向键／M 或空格，ESDF／Q，以及鼠标；可分配到任意席位。实时和回放共享同一套绘图。网页只监听本机，不提供网络联机。选择「打开回放」并载入 `match.jsonl`，即可播放、逐 tick 前后步进或点事件跳转。

```sh
node apps/cli/arena.js verify runs/tank-trouble/<match-id>/match.jsonl
node apps/cli/arena.js run --seed 42 --rounds 10
```

实时对局中的「停止对局」会完成当前 tick、结束比赛并保存已打的记录，不判胜负，也不能续打。「停止回放」会停止播放并回到第一帧，不改变日志。「对局详情」默认折叠，可展开计时、事件、动作与回放时间轴。

实际对局存于 `runs/<game-id>/<match-id>/`。实战或回放右上角可复制完整对局 ID，与该目录名一致。早期没有 `matchId` 的记录不显示 ID。其中 `manifest.json` 标记版本、种子、选手、运行参数；`match.jsonl` 包含初始状态、每 tick 的观测、提交动作、采纳动作、回退、事件、状态和 SHA-256；`result.json` 记录结果。浏览器直接显示保存的帧；CLI 校验使用原规则版本与采纳动作重算，不启动 bot。完整帧日志适合复盘，连续批量跑赛要留意磁盘用量。

## 接入 bot 或游戏

- [Bot JSONL 协议](protocol/bot/README.md)：每局一个常驻进程。支持受信任的本地 `.py`、`.js` 或 `.mjs` 脚本。内置 GPT-dots 和 Laika，可通过 `--bot-a` 和 `--bot-b` 替换。**本地进程不是安全沙箱。**
- [Bot JSON 注册](bots/README.md#注册到对战菜单)：放入脚本和 `bots/<目录>/bot.json` 即可在菜单选座或在 CLI 用注册 ID 对战。内置 Laika（复刻）和 GPT-dots 也用这套注册方式。
- [游戏适配器契约](protocol/game/README.md)：游戏决定 tick 频率及动作语义，宿主不解释物理。现有 [坦克规则](games/tank-trouble/RULES.md)；测试包含不同动作结构、不同 tick 频率的小型第二游戏。
- [本机界面协议](protocol/viewer/README.md)：画面与输入只是裁判的客户端。未来的《疯狂小人战斗》尚未接入。

写 bot 的 Agent 请从 [bots/README.md](bots/README.md) 开始，再看每款游戏目录的规则文件。坦克使用 v8 原版参数档，支持 2–8 席。默认 25 tick/秒，也可选 30 或 60；三档共享按秒计算的规则。历史 v1–v7 的旧回放仍按对应规则重算。

「对局设置」可选择先到 3 分或打满 1–20 局、地图宽高和开放／经典／密集三档迷宫。组队在「自定义对局」里分配 A–D 队，至少两队；友伤默认关闭，自伤仍有效。自由对战不在坦克旁标席位，组队时只标队伍字母。CLI 例：

```sh
node apps/cli/arena.js run --bot-a laika --bot-b gpt-dots --bot-c laika --bot-d gpt-dots \
  --simulation-rate 60 --round-limit 5 --cols 12 --rows 9 --maze-complexity dense \
  --teams '{"A":"1","B":"2","C":"1","D":"2"}' --friendly-fire off
```

`--round-limit` 是每场打几局；`--rounds` 仍是批量跑多少场。长赛制尤其是八席全量录像可能占较多磁盘。

每小局默认第 40 秒开始缩圈，用 15 秒缩完。安全范围保持地图的长宽比；坦克连续在外 2 秒才淘汰。只剩一辆坦克时，幸存者在结算阶段无敌。赛前界面可分别改开始时间和耗时，批量跑局也可用 `--shrink-after 40 --shrink-duration 15`（开始时间 0–120 秒，0 表示立即；耗时 1–120 秒）。都按游戏 tick 计时，不受浏览器帧率影响。

开局前可在「对局详情」给当前席位指定显示名，留空默认用注册名、bot 握手名字或席位 ID。实战和回放按选手统一坦克与其弹体配色；回放会自动用小圆圈跟随最终造成击毁的弹体；普通弹体不标记，实时对局不提示。展开「对局详情」仍可点「击杀标记」跳到命中帧。

实战和回放左侧显示当前局数与赛制，右侧是累计击杀（自伤不加），底部是各席位的名字、比分、普通弹空槽和特殊装备。超过四个席位时比分卡换行。新版保留每辆坦克 10 个普通弹槽；回放仍显示记录对应上限。普通弹命中或消失时释放一格，开火仍受按键状态和武器规则限制。

调试数值见 [classic-profile.json](games/tank-trouble/classic-profile.json)。改完重启并开新局；录制的帧会保留当时的显示参数。改过物理参数后若要校验此前的 v8 录像，请使用录像生成时的 JSON 版本。
