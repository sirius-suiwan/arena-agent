# Arena Agent

本地多游戏竞技场：编程 bot 和人类共用动作接口。首款游戏是按 4399 旧版重建的坦克迷宫对战。无需远程联机或向模型服务发请求。

## 工程结构

| 目录 | 责任 |
| --- | --- |
| `core/` | 通用裁判：固定 tick、选手和动作截止 |
| `protocol/` | bot、游戏及界面各自的接入契约 |
| `runners/`、`bots/examples/` | 进程管理和选手示例 |
| `games/` | 每款游戏独立维护规则、验证、物理与画法 |
| `replay/`、`runs/` | 录制和验证代码；生成的数据不入库 |
| `viewer/`、`apps/cli/` | 浏览器界面与本地命令入口 |
| `tests/` | 单元、协议、可重放和接入测试 |

开发规范见 [AGENTS.md](AGENTS.md)。项目使用 Node.js 22+；Python bot 需要 Python 3。

## 快速开始

```sh
npm test
node apps/cli/arena.js run --seed 42 --bot-b bots/examples/scout.py
node apps/cli/arena.js serve
```

CLI 输出本局目录。打开 [游戏选择页](http://127.0.0.1:8765/) 进入《坦克动荡 2》，或直接打开 [坦克菜单](http://127.0.0.1:8765/tank)。可启动 bot 对战、人机对战或本机同屏。A 使用方向键移动和转向，M 或空格开火；本地多人时 B 使用 ESDF / Q，三人模式的 C 使用鼠标。实时和回放共享同一套绘图。网页只监听本机，不提供网络联机。选择「打开回放」并载入 `match.jsonl`，即可播放、逐 tick 前后步进或点事件跳转。

```sh
node apps/cli/arena.js verify runs/tank-trouble/<match-id>/match.jsonl
node apps/cli/arena.js run --seed 42 --rounds 10
```

实时对局中的「暂停」等裁判完成当前 tick 后停住，按「继续」从下一 tick 恢复；回放的暂停只控制播放。「对局详情」默认折叠，可展开计时、事件、动作与回放时间轴。

实际对局存于 `runs/<game-id>/<match-id>/`。实战或回放右上角可复制完整对局 ID，与该目录名一致。早期没有 `matchId` 的记录不显示 ID。其中 `manifest.json` 标记版本、种子、选手、运行参数；`match.jsonl` 包含初始状态、每 tick 的观测、提交动作、采纳动作、回退、事件、状态和 SHA-256；`result.json` 记录结果。浏览器直接显示保存的帧；CLI 校验使用原规则版本与采纳动作重算，不启动 bot。完整帧日志适合复盘，连续批量跑赛要留意磁盘用量。

## 接入 bot 或游戏

- [Bot JSONL 协议](protocol/bot/README.md)：每局一个常驻进程。支持受信任的本地 `.py`、`.js` 或 `.mjs` 脚本。示例在 `bots/examples/`，可通过 `--bot-a` 和 `--bot-b` 替换。**本地进程不是安全沙箱。**
- [游戏适配器契约](protocol/game/README.md)：游戏决定 tick 频率及动作语义，宿主不解释物理。现有 [坦克规则](games/tank-trouble/RULES.md)；测试包含不同动作结构、不同 tick 频率的小型第二游戏。
- [本机界面协议](protocol/viewer/README.md)：画面与输入只是裁判的客户端。未来的《疯狂小人战斗》尚未接入。

写 bot 的 Agent 请从 [bots/README.md](bots/README.md) 开始，再看每款游戏目录的规则文件。坦克使用 v3 规则，新局默认是 12×9 格；历史 v1/v2 记录仍能校验。也可以启动时加 `--cols 16 --rows 12` 自定义地图尺寸，不改变旧回放。

开局前可在「对局详情」给当前席位指定显示名，留空就用 bot 握手提供的名字或席位 ID。实战和回放按选手统一坦克与其弹体配色；回放会自动用小圆圈跟随最终造成击毁的弹体；普通弹体不标记，实时对局不提示。展开「对局详情」仍可点「击杀标记」跳到命中帧。
