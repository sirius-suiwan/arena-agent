# Bot 协议 v1

UTF-8 JSON Lines；每行一个 JSON 对象。一个进程只参加一场，不共享状态。stdout 只写协议，stderr 写诊断。每行上限 64 KiB。超时、错误及不可用的动作按游戏定义的空动作处理，并由裁判记录。

1. 宿主发 `{"type":"start","protocol":1,"game":"tank-trouble","rulesVersion":"1","playerId":"A","tickRate":60,"config":{}}`，bot 回复 `{"type":"ready","protocol":1}`。
2. 宿主发 `{"type":"observe","tick":0,"observation":{}}`；bot 回复 `{"type":"action","tick":0,"action":{"throttle":1,"turn":0,"fire":false}}`。动作字段由游戏定义。每 tick 只接受一条对应的回复；失配或迟到不会被挪到下一 tick。
3. 对局结束后宿主关闭子进程。bot 也可以在 stdin EOF 时退出。

仅运行可信脚本。进程分离不限制脚本访问用户的网络、文件或启动其他程序。

## 选手名称（可选）

`ready` 可带 `name`，例如 `{"type":"ready","protocol":1,"name":"迷宫斥候"}`。仍兼容不发名称的 v1 协议 bot。宿主预设名优先，其次取 bot 提交名，否则显示席位 ID。名字移除控制字符、合并空白，最多保留 24 个 Unicode 码点。名称只影响显示，不影响动作、物理或状态校验。`manifest.playerNames` 记录实际显示名，回放沿用。复盘、动作和事件仍以 A/B/C 等席位 ID 为准。

## Arena 特殊能力：读指令与刷箱预报

这是本地坦克赛的非对称能力。所有席位的观测仍来自同一前置游戏状态，但动作按两阶段收集：普通席位（包括真人）先并行提交，裁判校验；随后只向授权席位的 `observe` 添加 `opponentActions`（按普通席位 ID 索引的**当前 tick** 采纳动作，含回退时的空动作）和 `opponentActionsTick`（等于当前 tick）。授权者彼此并行，不能读其他授权席位或自己的动作。没有普通席位时，动作表为空。两阶段共享该 tick 的时间预算，普通席位不会收到这两个字段，也不能通过握手、名字或注册声明自授权限。

当前只给随 Arena 提供的 Laika 加强层开放。坦克局还仅向该层提供 `pickupForecast`：`attemptTick` 是预计尝试刷箱的小局 tick，`ticksUntil` 是剩余 tick；两秒内且未满箱时可能附 `candidate:{x,y,type}`，是按当前场面和随机状态推算的候选，不承诺落点。预报不推进随机数、不预留格子或改变正常刷新。基础 Bot 协议仍为 v1，第三方 bot 无需更新。对局清单记录 `inputInsight.capabilities`（如 `pickup-forecast`）及席位，只保存实际采纳的动作；回放不重跑选手或重新推导情报。
