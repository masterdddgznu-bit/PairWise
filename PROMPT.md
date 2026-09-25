请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的 Saga 编排半成品。简单三步顺序成功通常正常；当你把「步骤失败/超时补偿、取消、crash/recover 幂等重放、多 saga 隔离、超时边界」组合在一起时，会出现不一致。请从状态机与日志/幂等键出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `SagaEngine`（见 `src/orchestrator.ts`）。核心约定：

**步骤语义**
- 步骤按定义顺序执行；成功时写 journal `StepCompleted` 并追加 effect `"do:" + stepName`
- 步骤返回 `{ ok: false, error }`（且 error 不是特殊 pending 标记）或超时时进入 `compensating`
- 补偿只对已成功完成的步骤，按**完成顺序的逆序**执行 compensate handler；effect 为 `"undo:" + label`，label 优先取 step 的 `compensate` 字段，否则用 step 名
- 全部步骤成功 → `completed`；补偿结束 → `failed`（步骤失败/超时）或 `aborted`（用户 cancel）；首步即失败且无已完成步 → `failed`

**超时**
- 步骤开始时记录 `stepDeadline = clock.now() + step.timeout`
- 当 `clock.now() >= stepDeadline` 时该步视为超时（含边界相等）
- 超时后即使 handler 稍后返回 `{ ok: true }` 也不得提交（late success 拒绝）

**Pending 重试**
- handler 返回 `{ ok: false, error: '__pending__' }` 表示本 tick 不推进，下一步 tick 再试（不记失败、不补偿）

**幂等**
- 幂等键为 `(sagaId, stepName, kind)`，kind 为 `do` 或 `undo`
- `recover()` / 重复 `tick()` 不得重复产生相同 do/undo effect

**cancel**
- 停止向前执行，并对已完成步骤启动补偿（逆序）；应取消该 saga 未触发的 timeout

**crash / recover**
- `crash()` 清空内存中的 saga 实例，但**保留** journal 与 idempotency 存储
- `recover()` 仅从 journal 重建内存状态，**不得**重新执行 step/compensate handler

**多 saga**
- 不同 `sagaId` 互不影响；`tick()` 应推进所有 running/compensating 的 saga

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — SagaDef、StepHandler、状态类型
- `src/journal.ts` — 追加日志与 replay
- `src/idempotency.ts` — do/undo 幂等键
- `src/timeout_wheel.ts` — 步骤 deadline 调度
- `src/step_executor.ts` — 单步执行
- `src/compensator.ts` — 补偿链
- `src/registry.ts` — 定义与 handler 注册
- `src/orchestrator.ts` — `SagaEngine`
- `src/index.ts` — 统一导出

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
