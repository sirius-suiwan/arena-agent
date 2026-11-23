# 本机界面协议 v1

- `POST /api/match` 请求 JSON `{"mode":"bots","seed":42}` ，模式可为 `bots`、`human`（A 为人类）、`local2` 或 `local3`。
- `GET /api/events` 使用 SSE：start（manifest 和初始 state）、tick（tick、state、events）、end（result）或 error。慢观众可能断开并重连，磁盘 JSONL 才是完整记录。
- `POST /api/input` 传当前的人类动作；可加 `playerId:"A"|"B"|"C"` 指定席位，省略时为 A。玩法相关字段由游戏定义。服务只监听回环；观战不会推动裁判。
- 回放从本地 `match.jsonl` 加载同样的 start/tick/end 记录，不重跑 bot。
