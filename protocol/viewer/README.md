# 本机界面协议 v1

- `GET /api/replay-storage` 返回 `{directory,defaultDirectory,custom,warning}`。同源 `POST /api/replay-storage` 传 JSON `{"directory":"/绝对/目录"}`，传 `null` 恢复启动默认目录。保存时验证目录可写，设置保存在宿主本机，同一工程的新网页对局才读取变更。本接口不浏览目录、不读取录像文件、不修改 CLI 的输出目录。
- `POST /api/match` 请求 JSON `{"mode":"bots"}`。可选 `seed`（安全整数，`0` 有效）；省略时由宿主生成，实际种子见 `manifest.seed`。模式可为 `bots`、`human`（A 为人类）、`local2` 或 `local3`。
- `GET /api/bots` 返回当前游戏注册表 `{"bots":[{"id":"laika","name":"Laika（复刻）"}]}`。开局可传 `bots:{"A":"laika","B":"gpt-dots"}`，值只接受注册 ID，不接受文件路径。Bot 对战可选 A、B 和 C，指定 C 则开三人局；人机对战只允许 B；纯本地多人不接受 bot 席位。未指定时 B 用 Laika，其余席用 GPT-dots。
- 自定义开局请求 `{"mode":"custom","seed":42,"seats":{"A":{"bot":"laika"},"D":{"control":"arrows"},"H":{"control":"mouse"}}}`。A–H 中任选 2–8 个席位，省略代表空席。每席只能指定注册 bot 或一套真人控制。真人控制 `arrows`、`esdf`、`mouse` 各限一个席位，满三套不能再加真人。不能混用 `seats` 和预设的 `bots`。录像清单中的 `humanControls` 是真人席位到控制的映射；纯 bot 自定义局是空映射。
- `GET /api/options` 返回本次启动的缩圈、赛制和地图默认值，包括 `mapSizeMode`、按参赛人数给出的 `autoMapSizes`、`autoMazeDensities`（复杂度档位）、`autoPickupProfiles`（`minSeconds`、`maxSeconds`、`maxOnField`）和 `simulationRate`（25/30/60，默认 25）。开局请求可覆盖该值；每局一旦开始不更改，回放按 `manifest.tickRate` 计时。`POST /api/match` 可在顶层覆盖 `shrinkAfterSeconds`（0–120，默认 40）、`shrinkDurationSeconds`（1–120，默认 15）、`roundLimit`（0–20，0 是先到目标分）、`cols`（4–16）、`rows`（4–12）、`mazeComplexity`（`auto` / `open` / `classic` / `dense`，默认 `auto`）或布尔值 `friendlyFire`。可指定 `mapSizeMode` 为 `auto` 或 `manual`；默认按实际启用席位匹配自动地图档位，显式宽高而不指定模式则按手动处理。服务启动指定了宽高时，网页默认手动；显式 `auto` 可覆盖。清单记录裁判选用的真实行列数与迷宫档位。刷箱固定取开局实占席位的档位，与手动地图参数无关。回放不会重新读取赛前偏好或推算尺寸。状态中的 `zone` 和每小局 `roundTick` 用于绘制实战与回放，不读客户端时钟。仅支持当前规则的录像。
- `GET /api/options` 提供 `shrinkCenter` 默认值，`POST /api/match` 可设为 `center`（默认）或 `random`。随机模式每小局固定终点；SSE 和普通 bot 仅有即时矩形，终点只通过内置 Laika 的私有预报送达。录像不写入坐标字段，终点可由种子重建。
- 启用队伍时，开局顶层传 `teams`，例如 `{"A":"1","B":"2","C":"1"}`。必须覆盖所有且仅实际参赛席位，使用至少两个队号。状态和结果将包含 `teamScores`、`roundWinnerTeam` 或 `winnerTeam`。
- `GET /api/events` 使用 SSE：start（manifest 和初始 state）、tick（tick、state、events）、end（result）或 error。慢观众可能断开并重连，磁盘压缩记录才是完整动作及事件序列。
- `POST /api/input` 传当前的人类动作；可加 `playerId` 指定 A–H 中正在用真人控制的席位，省略时为 A。可带当前 `matchId`，不匹配的输入会被拒绝。玩法相关字段由游戏定义。服务只监听回环；观战不会推动裁判。
- 回放在本地解压 `match.jsonl.gz`，用与对局相同的游戏规则和采纳动作重建帧状态，不上传文件，不重跑 bot。磁盘与实况 SSE 不同：精简日志不写观测和状态，只写输入、事件和校验哈希。


- 开局请求可选 `playerNames`，例 `{"A":"红队","B":"斥候"}`。只应用于本次选手席位；空名使用 bot 名或席位 ID。实战与回放从 `manifest.playerNames` 读取显示名。

- 停止实战：`POST /api/stop` 传 `{"matchId":"..."}`。裁判完成当前 tick 后结束本场，写入 `{"winner":null,"reason":"stopped"}` 并关闭选手进程，不判胜负，不可恢复。SSE 正常发送 `end`。若最后一个 tick 已自然结束，则返回真实结果。停止回放只把播放器送回开头。

- 实时 `start` 和 `tick` 可包含 `stats.kills`，为按席位统计的累计击杀，自伤不加。该字段由宿主为观战提供；回放可直接从日志的 `destroyed` 事件重建。
