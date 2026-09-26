请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的 Job Scheduler 半成品。单任务 claim/complete 通常正常；当你把「DAG 依赖就绪、租约过期窃取、fencing token、失败退避、crash/recover」组合在一起时，会出现不一致。请从 ready 判定、租约 token 与 journal/effects 出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `Scheduler`（见 `src/scheduler.ts`）。核心约定：

**DAG**
- `submit` 时若依赖 id 不存在或会形成环，抛错拒绝
- 任务仅当全部依赖状态为 `succeeded` 时才可被 claim（ready）
- 无依赖的任务彼此独立，可被不同 worker 并行 claim

**租约 / fencing**
- `claim` 为任务分配严格递增的 `leaseToken`（每次成功 claim 递增）
- `heartbeat` / `complete` / `fail` 必须匹配当前 `owner` 与 `leaseToken`，否则拒绝（no-op 或抛错，以不产生副作用为准）
- 租约在 `clock.now() >= leaseDeadline` 时过期（含相等边界）：`tick` 后任务回到可 claim 状态（通常 `pending`）
- 过期后其他 worker 可窃取；旧 token 的迟到 `complete` 必须被拒绝，且 effect 只由最终成功的那次 complete 追加一次

**重试**
- `fail` 使 `attempts` 加一；若 `attempts < maxAttempts`，进入 `retry_wait`，`retryAt = now + backoff`；否则标记 `failed`
- 退避取自构造参数 `retryBackoff`（默认 `[5,10]`），按失败次数选用
- `tick` 在 `now >= retryAt` 时将 `retry_wait` 转为 `pending`

**crash / recover**
- `crash()` 清空易失运行态，但**保留** journal、已持久化的 job 语义与 effects
- `recover()` 从 journal 重建内存状态；**不得**因重放已完成事件而重复追加 effects
- 崩溃时仍为 `running` 的任务恢复后应可被重新 claim（租约丢失）

**effects**
- 成功 `complete` 追加 `"done:" + work`，按完成顺序排列；同一任务只追加一次

默认：`leaseTtl=10`，`retryBackoff=[5,10]`，`maxAttempts=3`（逻辑毫秒）。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — Job、JobStatus、Lease
- `src/dag.ts` — ready 判定 / submit 环检测
- `src/job_store.ts` — 任务记录
- `src/lease_manager.ts` — claim/renew/expire 与 token
- `src/retry.ts` — 退避
- `src/journal.ts` — 追加日志
- `src/worker.ts` — claim/heartbeat/complete/fail
- `src/scheduler.ts` — `Scheduler` 门面
- `src/index.ts` — 统一导出

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
