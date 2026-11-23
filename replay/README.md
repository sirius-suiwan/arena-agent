# 对局回放格式

`match.jsonl.gz` 内是 UTF-8 JSON Lines，按顺序包含：

- `start`：`manifest`（`format: 2`、游戏／规则版本、tick 频率、seed、config、玩家等），开局状态 `hash`、席位 `readiness`。
- 每 tick 一条 `tick`：零起始的动作 tick，按席位索引的 `input`（`submitted`、`accepted`、`fallback`），规则事件 `events` 和执行后状态 `hash`。状态的 tick 比动作 tick 大一。
- `end`：`result`。手动停止仍会结束并写完整压缩流。缺少结束记录、顺序异常和损坏的压缩文件不作为完整对局。

状态 SHA-256 使用固定键排序的 JSON 表示。CLI 以清单初始化引擎，逐条施加采纳动作，核对状态哈希、事件和结果；无需选手进程。要重建某席在动作 tick *n* 的观测，用该局规则调用 `observe` 读取执行 *n* 前的状态。浏览器打开文件时也会用规则重建帧；完整状态哈希检查用 CLI `verify`。

不支持过去的全帧格式。回放依赖对应的引擎和配置，包括未更改规则版本号的调参；历史规则与配置保存在 Git。
