请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个确定性的进程内 Saga 编排器半成品。它不使用真实网络、定时器或数据库；所有执行结果由同步 API 注入，所有时间只由 `VirtualClock` 推进。简单顺序成功可以工作，但 attempt 幂等、退避边界、逆序补偿、append-only journal、崩溃恢复和 export/import 组合时会出现状态不一致。请从事件状态机、attempt 身份和可重放性定位耦合问题。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。

对外类为 `SagaRunner`（`src/runner.ts` / `src/index.ts`）：

- `new SagaRunner(clock?: VirtualClock)`
- `registerDefinition(def)`：定义名唯一；每步 `{ name, maxAttempts?, backoff?, compensate? }`，`maxAttempts` 默认 1，`backoff` 默认 0
- `begin(defName, input?, sagaId?)`：创建 saga，显式 id 可用于确定性测试；重复 id 必须拒绝
- `runNext(sagaId)`：同步推进一个动作。正向动作默认成功；处于补偿阶段时执行一个逆序补偿
- `failNext(sagaId, error?)`：给该 saga 的下一次正向 attempt 注入失败；失败若仍有 attempt，则进入 `waiting-retry`，否则进入 `compensating` 或直接 `failed`
- `tick(ms)`：仅推进 `VirtualClock`；到达 `retryAt` 后 saga 才重新变为 `running`
- `status(sagaId)`：返回防御性快照，含 status、stepIndex、completedSteps、compensatedSteps、attempt、retryAt、error
- `journalEntries(sagaId?)`：返回 append-only journal 的防御性副本
- `crashAndRecover()`：仅从 journal 重建运行态；不得重复正向 effect 或补偿
- `exportState()` / `importState(state)`：JSON-safe 状态往返；定义需先注册；导入后 id 序列、逻辑时钟与幂等状态继续

关键语义：

- 每次正向尝试由 `(sagaId, stepName, attempt)` 唯一标识；一次成功只能追加一个 `StepSucceeded`
- 步骤耗尽尝试后，只补偿已经成功的步骤，并严格按完成顺序逆序执行
- 退避为 `backoff * 2^(attempt-1)`，失败 attempt 为 1 时等待 `backoff`；`clock.now() === retryAt` 即可重试
- journal 只追加，不改写；恢复以事件为真相，半途 crash 后继续下一动作
- export/import 必须深拷贝，不能因调用方修改导出对象而污染 runner
- 未知定义、未知 saga、非法 tick、终态继续执行应抛 `SagaError`，且 `name === "SagaError"`

模块约 14 个：`types`、`clock`、`errors`、`definition`、`runtime`、`attempt`、`backoff`、`journal`、`replay`、`compensation`、`codec`、`guards`、`runner`、`index`。

验收：36 个测试全绿，`npm run build` 通过，且未改动 `tests/`。
