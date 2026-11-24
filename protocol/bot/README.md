# Bot 协议 v1

UTF-8 JSON Lines；每行一个 JSON 对象。一个进程只参加一场，不共享状态。stdout 只写协议，stderr 写诊断。每行上限 64 KiB。超时、错误及不可用的动作按游戏定义的空动作处理，并由裁判记录。

1. 宿主发 `{"type":"start","protocol":1,"game":"tank-trouble","rulesVersion":"1","playerId":"A","tickRate":60,"config":{}}`，bot 回复 `{"type":"ready","protocol":1}`。
2. 宿主发 `{"type":"observe","tick":0,"observation":{}}`；bot 回复 `{"type":"action","tick":0,"action":{"throttle":1,"turn":0,"fire":false}}`。动作字段由游戏定义。每 tick 只接受一条对应的回复；失配或迟到不会被挪到下一 tick。
3. 对局结束后宿主关闭子进程。bot 也可以在 stdin EOF 时退出。

仅运行可信脚本。进程分离不限制脚本访问用户的网络、文件或启动其他程序。

## 选手名称（可选）

`ready` 可带 `name`，例如 `{"type":"ready","protocol":1,"name":"迷宫斥候"}`。仍兼容不发名称的 v1 协议 bot。宿主预设名优先，其次取 bot 提交名，否则显示席位 ID。名字移除控制字符、合并空白，最多保留 24 个 Unicode 码点。名称只影响显示，不影响动作、物理或状态校验。`manifest.playerNames` 记录实际显示名，回放沿用。复盘、动作和事件仍以 A/B/C 等席位 ID 为准。

## Arena 特殊能力：刷箱与缩圈终点预报

所有席位使用同一前置游戏状态并发提交动作，使用同一个时间预算；任何席位都不会收到其他席位的指令。内置 Laika 加强层额外获得 `pickupForecast`：`attemptTick` 是预计尝试刷箱的小局 tick，`ticksUntil` 是剩余 tick；两秒内且未满箱时可能附 `candidate:{x,y,type}`，是按当前场面和随机状态推算的候选，不承诺落点。预报不推进随机数、不预留格子或改变正常刷新，也不会凭名字或注册声明开放给其他 Bot。基础 Bot 协议仍为 v1。清单在 `inputInsight` 中记录启用的能力和席位；回放按实际采纳的动作运行，不重跑 Bot 或推导情报。

随机缩圈开启时，Laika 的内置加强层还接收 `shrinkDestination:{x,y,startsAt,endsAt}`，坐标是世界像素，开始与结束是小局 tick。普通 bot 和观众只收到实际在缩的矩形，不收到这个字段。它只用于提前导航，不会发给 bot 子进程，不会影响并行派发或裁判。回放保留种子和配置以复现对局，独享预报不是加密或安全隔离。
