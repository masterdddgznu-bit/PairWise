## 简述
实现一个进程内分阶段配置发布协调器。节点目录、发布波次、健康投票、超时回滚与追加型审计日志必须保持一致，并可从日志恢复仍在进行的发布。

## 需求
从 `src/index.ts` 导出 `VirtualClock`、`RollPlan`、`RollPlan.fromJournal`、`RollPlanError`、`InvalidConfigError`、`InvalidArgumentError`、`CapacityError`、`ConflictError`、`NotFoundError`、`StateError`。

构造配置为 `{ clock, waveMs, maxNodes?, maxRollouts?, maxWaves? }`。`waveMs` 为正整数；其余上限默认为 32、8、8，且均为正整数。

节点通过 `registerNode(node, zone, version)` 注册，三个值均为非空字符串；节点名唯一，达到 `maxNodes` 后拒绝新增。`nodes()` 按注册顺序返回，`nodeVersion(node)` 返回当前可见版本。

`beginRollout(targetVersion, waveSizes)` 创建发布并返回稳定递增的发布 ID。`waveSizes` 是长度不超过 `maxWaves` 的正整数数组，其总容量必须足以覆盖创建时尚未处于其他发布中的全部节点。创建时冻结候选节点，后注册节点不加入；同一节点任一时刻只能属于一个未终结发布。发布波次必须确定、无重复，并在可行时让同一区域的节点分散到不同波次。

`startNextWave(rolloutId)` 启动下一波并返回成员与 `deadline = clock.now() + waveMs`。启动时成员立即临时切换为目标版本，同时保留各自先前版本；正在等待健康结果的波次不能再次启动。`activeWave` 可查询当前波次及期限。

`report(rolloutId, node, healthy)` 只接受当前活动波次成员的布尔健康结果。相同结果重复上报幂等；同一节点改票冲突。`reports` 返回当前波次报告。

`finalizeWave(rolloutId)` 仅在截止前且所有成员均已报告健康时提交该波；缺报告时返回 `false`。任一不健康报告触发整个发布回滚，所有已提交或临时切换的成员恢复各自发布前版本。截止时刻及之后不得提交。最后一波提交后发布完成并释放节点。

`drive()` 只处理已经达到截止时间的活动波，将对应发布回滚，并按发布 ID 顺序返回回滚 ID。时间前进本身没有副作用。`abort(rolloutId)` 显式回滚未终结发布；已终结发布不可再次改变。

`status(rolloutId)` 返回 `pending | active | completed | rolledback | aborted`。查询方法必须无副作用，且返回值不能泄露可变内部状态。

每次成功改变状态的操作追加一条审计 WAL；失败、返回 `false`、空 `drive` 和幂等重复报告不追加。`journal()` 返回日志副本。`RollPlan.fromJournal(clock, configWithoutClock, entries)` 必须严格重放，恢复节点注册序、发布 ID、冻结成员、波次游标、已提交与临时版本、先前版本、期限及报告；恢复后的后续行为与原实例一致。篡改、乱序或语义不可能的日志必须抛 `StateError`。

## 约束
- 初始仓库没有 `src/`，请自行创建源码与模块划分；不要修改 `tests/`。
- 不要增加外部依赖；禁止真实网络、数据库、`setTimeout`、`Math.random`。
- 时间只来自注入的 `VirtualClock`，其 `advance(ms)` 对负数或非整数抛 `InvalidArgumentError`。
- 所有容量、冲突和状态失败均不得留下部分状态，也不得写 WAL。

## 验收
`npm test` 与 `npm run build` 全部通过。
