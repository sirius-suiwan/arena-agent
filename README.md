# Arena Agent

本地多游戏竞技场：编程 bot 和人类共用动作接口。先接坦克迷宫对战，再验证第二款游戏能独立接入。无需远程联机或向模型服务发请求。

## 工程结构

| 目录 | 责任 |
| --- | --- |
| `core/` | 通用裁判：固定 tick、选手和动作截止 |
| `protocol/` | bot、游戏及界面各自的接入契约 |
| `runners/`、`bots/examples/` | 进程管理和选手示例 |
| `games/` | 每款游戏独立维护规则、验证、物理与画法 |
| `replay/`、`runs/` | 录制和验证代码；生成的数据不入库 |
| `viewer/`、`apps/cli/` | 浏览器界面与本地命令入口 |
| `tests/` | 单元、协议、可重放和接入测试 |

开发规范见 [AGENTS.md](AGENTS.md)。项目使用 Node.js 22+；Python bot 需要 Python 3。
