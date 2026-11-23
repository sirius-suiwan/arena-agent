# Bot 协议 v1

UTF-8 JSON Lines；每行一个 JSON 对象。一个进程只参加一场，不共享状态。stdout 只写协议，stderr 写诊断。每行上限 64 KiB。超时、错误及不可用的动作按游戏定义的空动作处理，并由裁判记录。

1. 宿主发 `{"type":"start","protocol":1,"game":"tank-trouble","rulesVersion":"1","playerId":"A","tickRate":60,"config":{}}`，bot 回复 `{"type":"ready","protocol":1}`。
2. 宿主发 `{"type":"observe","tick":0,"observation":{}}`；bot 回复 `{"type":"action","tick":0,"action":{"throttle":1,"turn":0,"fire":false}}`。动作字段由游戏定义。每 tick 只接受一条对应的回复；失配或迟到不会被挪到下一 tick。
3. 对局结束后宿主关闭子进程。bot 也可以在 stdin EOF 时退出。

仅运行可信脚本。进程分离不限制脚本访问用户的网络、文件或启动其他程序。
