## 简述
实现一个把 `left` 与 `right` 两条独立输入流按业务键增量连接的内存物化视图。系统必须协调每源乱序待处理事件、水位、修正与撤回、冻结命名快照，并用追加型变更日志完整恢复下一步行为。

## 需求
从 `src/index.ts` 导出 `VirtualClock`、`DualView`、`DualView.fromJournal`，以及 `DualViewError`、`InvalidConfigError`、`InvalidArgumentError`、`SequenceError`、`WatermarkError`、`ConflictError`、`CapacityError`、`SnapshotError`。

`new DualView({ clock, maxKeys?, maxPending?, maxSnapshots? })` 中三个上限默认分别为 100、100、10，必须是正整数。`VirtualClock` 提供 `now()` 与 `advance(ms)`，拒绝负数。

`ingest(source, seq, eventId, key, op, value?)` 接收 `left` 或 `right` 事件。每源序号从 1 连续摄入，通常必须恰为该源下一序号；尚未物化且仍在水位之上的既有序号可由新事件 ID 修正，替换原事件。相同 event ID 与完全相同事件体重复摄入是无副作用的幂等操作；相同 ID 搭配不同事件体冲突。`upsert` 必须携带 value，`retract` 不得携带 value。事件 ID 在两源间也必须唯一。待处理总量受 `maxPending` 限制。

`advanceWatermark(source, seq)` 只推进指定源水位，水位不可回退且不得超过该源最高已摄入序号。相同水位是无副作用操作。`materialize()` 把两源中水位以内且尚未应用的事件按 `(seq, source)` 确定序应用，序号相同时 `left` 在前，返回本次应用数量。推进水位本身不物化，查询也不产生副作用。

每个源对每个键独立保存当前可见侧值。`upsert` 设置该侧，`retract` 清除该侧。`get(key)` 仅在两侧都可见时返回 `{ left, right }`，否则返回 `null`；`keys()` 仅返回已连接键并按字典序排列。`pending(source)` 返回该源尚未物化的事件只读副本，按序号排列。修正只影响尚未物化的事件，已经物化或已经进入水位范围的序号不可修正。

`snapshot(name)` 冻结调用时已经物化的连接结果，不能包含水位内但尚未 `materialize()` 的事件。名称非空且不可重复；数量受 `maxSnapshots` 限制。`readSnapshot(name,key)` 读取冻结结果，`snapshotKeys(name)` 返回字典序键列表，`dropSnapshot(name)` 删除并返回是否存在。后续物化、撤回与值对象的外部修改不得改变快照。

所有成功且实际改变状态的 `ingest`、水位推进、`materialize`、快照创建和删除都必须追加 mutation WAL；失败与无副作用幂等操作不得追加。`journal()` 返回不可由调用方篡改内部状态的副本。`DualView.fromJournal(clock, opts, entries)` 必须验证并重放日志，恢复待处理事件、水位、物化两侧、event ID 去重、快照和容量占用；恢复实例继续摄入、修正、物化与创建快照时应与原实例一致。日志条目带逻辑时间，但重放不得推进注入时钟。

## 约束
- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要增加外部依赖。
- 禁止真实网络、数据库、`setTimeout`、`Math.random`。
- 时间只能来自注入的 `VirtualClock`。

## 验收
`npm test` 与 `npm run build` 全部通过。
