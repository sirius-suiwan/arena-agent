# 本机界面协议 v1

- `POST /api/match` 请求 JSON `{"mode":"bots","seed":42}` ，模式可为 `bots`、`human`（A 为人类）、`local2` 或 `local3`。
- `GET /api/events` 使用 SSE：start（manifest 和初始 state）、tick（tick、state、events）、end（result）或 error。慢观众可能断开并重连，磁盘 JSONL 才是完整记录。
- `POST /api/input` 传当前的人类动作；可加 `playerId:"A"|"B"|"C"` 指定席位，省略时为 A。玩法相关字段由游戏定义。服务只监听回环；观战不会推动裁判。
- 回放从本地 `match.jsonl` 加载同样的 start/tick/end 记录，不重跑 bot。


- 开局请求可选 `playerNames`，例 `{"A":"红队","B":"斥候"}`。只应用于本次选手席位；空名使用 bot 名或席位 ID。实战与回放从 `manifest.playerNames` 读取显示名。

- 停止实战：`POST /api/stop` 传 `{"matchId":"..."}`。裁判完成当前 tick 后结束本场，写入 `{"winner":null,"reason":"stopped"}` 并关闭选手进程，不判胜负，不可恢复。SSE 正常发送 `end`。若最后一个 tick 已自然结束，则返回真实结果。停止回放只把播放器送回开头。

- 实时 `start` 和 `tick` 可包含 `stats.kills`，为按席位统计的累计击杀，自伤不加。该字段由宿主为观战提供；历史回放可直接从日志的 `destroyed` 事件重建。
