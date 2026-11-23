# 本机界面协议 v1

- `POST /api/match` 请求 JSON `{"mode":"bots","seed":42}` 或 `mode:"human"`。人类为 A。
- `GET /api/events` 使用 SSE：start（manifest 和初始 state）、tick（tick、state、events）、end（result）或 error。慢观众可能断开并重连，磁盘 JSONL 才是完整记录。
- `POST /api/input` 传当前的人类动作；玩法相关字段由游戏定义。服务只监听回环；观战不会推动裁判。
- 回放从本地 `match.jsonl` 加载同样的 start/tick/end 记录，不重跑 bot。
