# Bot 协议 v1

UTF-8 JSON Lines；每行一个 JSON 对象。一个进程只参加一场，不共享状态。stdout 只写协议，stderr 写诊断。每行上限 64 KiB。超时、错误及不可用的动作按游戏定义的空动作处理，并由裁判记录。

1. 宿主发 `{"type":"start","protocol":1,"game":"tank-trouble","rulesVersion":"1","playerId":"A","tickRate":60,"config":{}}`，bot 回复 `{"type":"ready","protocol":1}`。
2. 宿主发 `{"type":"observe","tick":0,"observation":{}}`；bot 回复 `{"type":"action","tick":0,"action":{"throttle":1,"turn":0,"fire":false}}`。动作字段由游戏定义。每 tick 只接受一条对应的回复；失配或迟到不会被挪到下一 tick。
3. 对局结束后宿主关闭子进程。bot 也可以在 stdin EOF 时退出。

仅运行可信脚本。进程分离不限制脚本访问用户的网络、文件或启动其他程序。

## 选手名称（可选）

`ready` 可带 `name`，例如 `{"type":"ready","protocol":1,"name":"迷宫斥候"}`。仍兼容不发名称的 v1 协议 bot。宿主预设名优先，其次取 bot 提交名，否则显示席位 ID。名字移除控制字符、合并空白，最多保留 24 个 Unicode 码点。名称只影响显示，不影响动作、物理或状态校验。`manifest.playerNames` 记录实际显示名，回放沿用。复盘、动作和事件仍以 A/B/C 等席位 ID 为准。
