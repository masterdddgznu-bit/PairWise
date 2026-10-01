请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的跨分片 2PC 事务协调器半成品。单分片 begin/write/commit 通常正常；当你把「多分片 prepare/commit、VirtualClock 超时、写冲突与锁、journal 回放、export/import 恢复 prepared 事务」组合在一起时，会出现不一致。请从事务状态机与分片 prepare 集合出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `ShardTxn`（见 `src/coordinator.ts` / `src/index.ts`）。核心 API：

- `new ShardTxn(clock: VirtualClock, opts: { shardCount, prepareTimeoutMs })`
- `begin(): string` — 分配 txnId
- `read(txnId, key): string | undefined` — 缓冲写可见；否则读已提交值
- `write(txnId, key, value): void` — 写入事务缓冲
- `commit(txnId): { ok: boolean, reason?: string }` — 2PC：对所有触及分片 prepare（版本检查/加锁）；全部成功则 commit，否则 abort；prepare 超过 `prepareTimeoutMs`（按 clock）则 abort
- `abort(txnId): void`
- `get(key): string | undefined` — 已提交读
- `exportState()` / `importState(state)` — 崩溃恢复；prepared 事务按超时 commit 或 abort
- `routeKey(key): number` — 键路由到分片（测试用）

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` / `src/errors.ts` — 事务/分片/快照类型
- `src/router.ts` — 键哈希路由
- `src/shard.ts` — 分片 KV（value + version）
- `src/lock.ts` — prepare 阶段键锁
- `src/prepare.ts` — 单分片 prepare 与超时判定
- `src/journal.ts` — 操作日志与回放
- `src/recover.ts` — 快照序列化/恢复
- `src/coordinator.ts` — `ShardTxn` 门面
- `src/index.ts` — 统一导出

具体行为以 tests 为准。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
