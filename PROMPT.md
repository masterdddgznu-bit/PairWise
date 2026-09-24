请在当前 TypeScript 仓库中补全 `src/` 下的实现，使 `npm test` 与 `npm run build` 全部通过。

目标：实现一个进程内的 DAG 工作流编排器（`Orchestrator`），支持多租户公平调度、失败重试、取消传播与崩溃检查点恢复。

必须满足：
1. 只允许修改 `src/`；禁止修改 `tests/` 与测试断言。
2. 工作流是有向无环图：节点是 task，边是依赖；只有全部前置成功后才可运行后继。
3. 调度：
   - 全局并发上限 `maxWorkers`
   - 多租户 fair-share：同一时刻尽量轮转不同 tenant 的 runnable task（见测试）
   - 同一 task 不可被并发执行两次
4. 失败与重试：
   - task 可配置 `maxAttempts` 与指数退避；退避公式必须与 `tests/helpers.ts` 的 `expectedBackoffMs` 一致
   - 超过次数则 task 失败，并导致依赖它的下游不再启动；整个 run 记为 failed
5. 取消：
   - `cancel(runId)` 后，未开始的 task 不得再启动；已在跑的 task 应收到 cancel 信号（通过 context）并尽快结束
   - 取消后 run 状态为 `cancelled`
6. 崩溃恢复：
   - `checkpoint()` 必须持久化（可用内存结构模拟 durable log）足够信息
   - `crash()` 丢掉易失状态后，`recover()` + 继续 `drain()` 应能从不完整进度恢复，且成功 task 不重复执行副作用（用测试里的 `EffectLog` 校验幂等）
7. 不得引入网络/数据库等外部依赖；不要添加无关大文件。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
