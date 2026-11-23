# Bot 协议 v1

UTF-8 JSON Lines；每行一个 JSON 对象。一个进程只参加一场，不共享状态。stdout 只写协议，stderr 写诊断。每行上限 64 KiB。超时、错误及不可用的动作按游戏定义的空动作处理，并由裁判记录。

1. 宿主发 `{"type":"start","protocol":1,"game":"tank-trouble","rulesVersion":"1","playerId":"A","tickRate":60,"config":{}}`，bot 回复 `{"type":"ready","protocol":1}`。
2. 宿主发 `{"type":"observe","tick":0,"observation":{}}`；bot 回复 `{"type":"action","tick":0,"action":{"throttle":1,"turn":0,"fire":false}}`。动作字段由游戏定义。每 tick 只接受一条对应的回复；失配或迟到不会被挪到下一 tick。
3. 对局结束后宿主关闭子进程。bot 也可以在 stdin EOF 时退出。

仅运行可信脚本。进程分离不限制脚本访问用户的网络、文件或启动其他程序。

## 选手名称（可选）

`ready` 可带 `name`，例如 `{"type":"ready","protocol":1,"name":"迷宫斥候"}`。仍兼容不发名称的 v1 协议 bot。宿主预设名优先，其次取 bot 提交名，否则显示席位 ID。名字移除控制字符、合并空白，最多保留 24 个 Unicode 码点。名称只影响显示，不影响动作、物理或状态校验。`manifest.playerNames` 记录实际显示名，回放沿用。复盘、动作和事件仍以 A/B/C 等席位 ID 为准。

## Arena 特殊能力：读指令

这是本地坦克赛的非对称能力，不是所有 bot 可用的协议字段。所有席位仍并行提交，并看到同一前置游戏状态。裁判仅给授权席位的 `observe` 添加 `opponentActions`（按其他席位 ID 索引的**上一 tick**采纳动作，包括真人和回退时的空动作）和 `opponentActionsTick`（动作的 tick）。首个 tick 为 `{}` 与 `null`。授权者不读自己，也不能读任何席位的当前 tick 动作。普通席位不会收到这两个字段，也不能通过握手、名字或注册声明自授权限。

当前只给随 Arena 提供的 Laika 加强层开放。基础 Bot 协议仍为 v1，第三方 bot 无需更新。对局清单记录 `inputInsight`，并保存实际采纳的动作；回放不重跑选手或重新推导指令。
