# 本机界面协议 v1

- `POST /api/match` 请求 JSON `{"mode":"bots","seed":42}` ，模式可为 `bots`、`human`（A 为人类）、`local2` 或 `local3`。
- `GET /api/bots` 返回当前游戏注册表 `{"bots":[{"id":"laika","name":"Laika（复刻）"}]}`。开局可传 `bots:{"A":"laika","B":"scout"}`，值只接受注册 ID，不接受文件路径。Bot 对战可选 A、B 和 C，指定 C 则开三人局；人机对战只允许 B；纯本地多人不接受 bot 席位。未指定的 bot 席位用 `turret`。
- 自定义开局请求 `{"mode":"custom","seed":42,"seats":{"A":{"bot":"laika"},"D":{"control":"arrows"},"H":{"control":"mouse"}}}`。A–H 中任选 2–8 个席位，省略代表空席。每席只能指定注册 bot 或一套真人控制。真人控制 `arrows`、`esdf`、`mouse` 各限一个席位，满三套不能再加真人。不能混用 `seats` 和预设的 `bots`。录像清单中的 `humanControls` 是真人席位到控制的映射；纯 bot 自定义局是空映射。
- `GET /api/options` 返回宿主本次启动的缩圈设置（默认 `{"shrinkAfterSeconds":40,"shrinkDurationSeconds":15}`）。`POST /api/match` 的任一模式可在顶层覆盖这两个字段，值分别为 0–120、1–120 的整数秒。状态中的 `zone` 和每小局 `roundTick` 用于绘制实战与回放，不读客户端时钟。没有 `zone` 的旧记录不画边界。
- `GET /api/events` 使用 SSE：start（manifest 和初始 state）、tick（tick、state、events）、end（result）或 error。慢观众可能断开并重连，磁盘 JSONL 才是完整记录。
- `POST /api/input` 传当前的人类动作；可加 `playerId` 指定 A–H 中正在用真人控制的席位，省略时为 A。可带当前 `matchId`，不匹配的输入会被拒绝。玩法相关字段由游戏定义。服务只监听回环；观战不会推动裁判。
- 回放从本地 `match.jsonl` 加载同样的 start/tick/end 记录，不重跑 bot。


- 开局请求可选 `playerNames`，例 `{"A":"红队","B":"斥候"}`。只应用于本次选手席位；空名使用 bot 名或席位 ID。实战与回放从 `manifest.playerNames` 读取显示名。

- 停止实战：`POST /api/stop` 传 `{"matchId":"..."}`。裁判完成当前 tick 后结束本场，写入 `{"winner":null,"reason":"stopped"}` 并关闭选手进程，不判胜负，不可恢复。SSE 正常发送 `end`。若最后一个 tick 已自然结束，则返回真实结果。停止回放只把播放器送回开头。

- 实时 `start` 和 `tick` 可包含 `stats.kills`，为按席位统计的累计击杀，自伤不加。该字段由宿主为观战提供；历史回放可直接从日志的 `destroyed` 事件重建。
