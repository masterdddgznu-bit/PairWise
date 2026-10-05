## 简述
实现一个确定性的 schema 注册与演进协调器。它同时维护兼容关系、消费者所处版本、发布屏障、退休条件和可精确恢复的审计历史。

## 需求
- 从 `src/index.ts` 导出 `SchemaEvo`、`SchemaEvoError` 以及公开类型。构造参数包含 `{ clock, rolloutMs, maxSubjects?, maxVersions?, maxConsumers?, maxRollouts? }`，其中时钟仅提供 `now(): number`。
- 支持注册 subject 与不可变初始 schema、添加带 `compatibleWith` 前驱集合的新版本、注册消费者，并查询当前版本、消费者版本和版本历史。兼容性按有向图可达关系判断，退休版本不可再作为新兼容关系的依据。
- 同一 subject 同时至多有一个活动 rollout。`beginRollout(subject, targetVersion, consumers?)` 固化成员快照并返回稳定 ID；省略成员时使用当时全部消费者。开始前必须确认每个成员都能从自身当前版本沿兼容图到达目标版本。
- `ack(rolloutId, consumer, accept)` 记录成员决定；相同决定重复提交幂等，改变既有决定冲突。`finalize` 仅在快照成员全部接受且未到截止时间时提交，并原子推进 subject 当前版本及快照成员版本；拒绝或到期会中止。`drive()` 处理到期的活动 rollout，时钟前进本身不产生状态变化。
- 新注册消费者不加入已经开始的 rollout。旧版本仅能在已有后继版本成功发布、没有消费者仍停留其上、不是 subject 当前版本且不被活动发布依赖时退休。
- 所有成功状态变更写入 append-only WAL；失败和幂等操作不得追加记录。`journal()` 返回隔离副本，`SchemaEvo.fromJournal(options, journal)` 必须精确恢复活动与终结状态，使恢复后的 `drive` 或 `finalize` 与原实例产生相同结果和日志。
- 提供 `status`、`currentVersion`、`consumerVersion`、`versions`、`reports`、`journal` 查询；所有查询均无副作用，返回值不可用于篡改内部状态。错误通过带稳定 `code` 的 `SchemaEvoError` 报告。

## 约束
- 不要修改 `tests/`。
- 不得添加外部运行时依赖，不得访问真实网络或数据库。
- 禁止使用真实计时器、`setTimeout`、`Date.now`、`Math.random`；所有时间只来自注入的 VirtualClock。
- schema 与所有公开快照必须防御调用方后续修改。任何校验失败必须保持跨模块状态与 WAL 原子不变。
- 实现应拆分为多个有独立状态与职责的模块，不能把全部状态机集中在单个文件。

## 验收
`npm test` 与 `npm run build` 全部通过。
