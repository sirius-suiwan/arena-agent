# 本机界面协议 v1

- `POST /api/match` 请求 JSON `{"mode":"bots","seed":42}` ，模式可为 `bots`、`human`（A 为人类）、`local2` 或 `local3`。
- `GET /api/events` 使用 SSE：start（manifest 和初始 state）、tick（tick、state、events）、end（result）或 error。慢观众可能断开并重连，磁盘 JSONL 才是完整记录。
- `POST /api/input` 传当前的人类动作；可加 `playerId:"A"|"B"|"C"` 指定席位，省略时为 A。玩法相关字段由游戏定义。服务只监听回环；观战不会推动裁判。
- 回放从本地 `match.jsonl` 加载同样的 start/tick/end 记录，不重跑 bot。

- 实时暂停：`POST /api/pause` 传 `{"paused":true,"matchId":"..."}`。matchId 来自 start 的 manifest。当前 tick 如已开始，会完成记录后再确认；响应为 `{paused,tick,matchId}`。SSE 同步 `type:"pause"`，重连会收到当前状态。恢复不补跑暂停期间的 tick；暂停不写入回放、不改变规则。暂停时清空各人类选手按键，新的输入不采纳。

- 开局请求可选 `playerNames`，例 `{"A":"红队","B":"斥候"}`。只应用于本次选手席位；空名使用 bot 名或席位 ID。实战与回放从 `manifest.playerNames` 读取显示名。
