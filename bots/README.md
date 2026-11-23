# 给写 bot 的 Agent

先读两份文档：[统一 Bot 协议](../protocol/bot/README.md)告诉你**消息怎么收发**，[坦克动荡规则](../games/tank-trouble/RULES.md)告诉你**这个游戏里能观察什么、能做什么、如何计分**。接入其他游戏时读相应 `games/<game-id>/RULES.md`，不要套用坦克字段。写 bot 不需要改裁判、物理、回放或网页。

## 从内置选手开始

- [GPT-dots](gpt-dots/) 与 [Laika（复刻）](laika/) 都使用同一 JSONL 接口。新选手仍支持 JS 和 Python。

## 注册到对战菜单

把脚本和声明放到 `bots/<你的目录>/`，例如 `bots/maze-hunter/bot.json`：

```json
{
  "schema": 1,
  "protocol": 1,
  "id": "maze-hunter",
  "name": "迷宫猎手",
  "game": "tank-trouble",
  "entry": "bot.py",
  "files": ["strategy.py"]
}
```

- `id` 在同一游戏下唯一，长 1–48 位，以小写字母开头，支持小写字母、数字和连字符；`name` 最多 24 字，作为菜单和默认席位显示名。
- `entry` 是包内 `.js`、`.mjs` 或 `.py` 入口；宿主按后缀选择 Node.js 或 Python 3，不接受自定义命令。路径用包内相对路径，不能跨出目录。额外模块和策略数据通过可选的 `files` 列出；日志记录声明、入口及这些依赖的组合 SHA-256，便于复盘。依赖不会自动安装。
- 刷新坦克页面，新 bot 就会出现在选座菜单里，无需修改宿主。一个目录也可使用多个 `<name>.bot.json`。声明或路径错误会提示对应清单；修正后刷新即可。
- CLI 接受注册 ID，也保留直接指定脚本路径的用法。`--bot-a` 到 `--bot-h` 支持最多八席。A、B 默认参赛，C–H 只在指定时加入；各席独立运行，允许同一个 bot 出现在多个席位。自定义真人席位用网页。

```sh
node apps/cli/arena.js run --seed 42 --bot-a laika --bot-b maze-hunter --bot-c gpt-dots

# 八个独立进程，同一 bot 可以多次参赛
node apps/cli/arena.js run --seed 42 --bot-a laika --bot-b laika --bot-c gpt-dots --bot-d gpt-dots \
  --bot-e gpt-dots --bot-f laika --bot-g gpt-dots --bot-h laika
```

[Laika（复刻）](laika/README.md)、[GPT-dots](gpt-dots/README.md) 都通过声明注册。注册不是安全审核；脚本依旧是本地进程，只运行可信的 bot。

```sh
# 从仓库根目录运行。标准输出每行都有该场目录和结果。
node apps/cli/arena.js run --seed 12 --score-to-win 1 \
  --bot-a gpt-dots --bot-b laika

# 两个选手对调，同样种子再跑一次；比较时不要只看一局。
node apps/cli/arena.js run --seed 12 --rounds 3 --score-to-win 1 \
  --bot-a laika --bot-b gpt-dots
```

每局一个常驻进程。收到 `start`，回复 `{"type":"ready","protocol":1}`；收到 `observe`，用该消息的 **原样 tick** 回复一条动作：

```json
{"type":"action","tick":42,"action":{"throttle":0,"turn":-1,"fire":true}}
```

坦克对局提供 `observation.profile`，其中包含 `tickRate` 和以当前 tick 为单位的运动、武器量。按秒换算自己的计时；普通炮弹要先松开再按，不是长按连发。

只把 JSON Lines 写到 stdout，及时刷新；诊断写 stderr。只用收到的观测决策，不读裁判内部状态或对手文件。保证动作在期限内返回；超时、非法或错 tick 的回复不会补到下一帧。用私有随机数时，为复现实验显式固定它的种子。当前运行器不是安全沙箱，只运行自己审核过的脚本。

## 看一局、改一次、再比较

1. 打开该局的 `manifest.json`：核对规则版本、种子、座位和 bot 文件 SHA-256。对比策略时固定这些条件，记录修改前后的 bot 版本。
2. 运行 `node apps/cli/arena.js report 路径/match.jsonl.gz > report.json`。先看超时、非法动作、撞墙和道具统计，再看命中、击毁及局末事件。统计是证据，不代表已经判明 bot 的决策原因。
3. 找到关键 tick 后加 `--tick 123` 导出前后约两秒的采样。完整的 `submitted`、`accepted`、`fallback` 在 `gzip -dc 路径/match.jsonl.gz` 的 `input[座位]`；引擎使用 `accepted`。弹丸 ID 每小局重置，要连同局号看。
4. 可在本机网页直接打开 `match.jsonl.gz` 看回放，也可用 `node apps/cli/arena.js verify 路径/match.jsonl.gz` 只校验。回放、报告和校验不重新运行 bot。

每轮只改一个假设，例如「射击前预测一次反弹是否打回自己」，再用相同的多组种子与交换座位复测。看胜负之外，也看自伤次数和回退比例。

不需要改 `playerId` 来命名。注册 bot 默认使用声明的 `name`；未注册的脚本可在 `ready` 中加 `"name":"迷宫斥候"`。CLI 的 `--name-a` 到 `--name-h` 可为本场指定显示名。
