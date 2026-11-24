# 游戏适配器接口 v1

- `id`、`version`、`tickRate` 为游戏 ID、规则版本、每游戏秒的固定 tick 数。
- `init({seed, config, players})` 返回 tick 0 的可序列化状态。玩家 ID 是字符串。
- `observe(state, playerId)` 返回该席位可见信息；不得修改状态。
- 可选 `insightCapabilities` 声明固定情报名，或由 `insightCapabilitiesForConfig(config)` 按配置声明；`privilegedObservation(state)` 为宿主已授权的席位计算附加观测，不得覆盖标准观测字段、修改状态或推进随机数。普通席位仍只收到 `observe`，没有授权席位时不调用。
- 可选 `spectateState(state)` 返回实况观战可公开的状态，用于移除裁判私有字段。不得修改权威状态或影响记录哈希。
- `validateAction(action)` 返回规范化动作或抛错；`neutralAction()` 返回有效空动作。
- `step(state, actions)` 返回 `{state, events, result}`，只能推进一个 tick。actions 按玩家 ID 索引；result 为 null 或 `{winner,reason}`。所有动作来自同一前置状态。不得依赖时间、I/O、未设种子的随机。
- 规则变化提升 `version`。需要跨引擎版本或跨平台的位级确定性时，另行选择数值表示并验收，不默认保证。
