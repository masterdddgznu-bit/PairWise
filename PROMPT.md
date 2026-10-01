请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的多租户批量队列半成品。简单 enqueue / flush 通常正常；当你把「批次大小边界、等待时间边界、enqueue 前后到期检查、poll 扫描、租户隔离、export/import 恢复」组合在一起时，会出现不一致。请从 VirtualClock 时间轴与 pending 批次状态出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `BatchQueue`（见 `src/queue.ts` / `src/index.ts`）。核心 API：

- `new BatchQueue(clock: VirtualClock, opts: { maxBatch, maxWaitMs })`
- `enqueue(tenant, item): { flushed: T[] | null }` — 追加；若触发自动 flush 则返回被 flush 的 payload 列表，否则 null
- `flush(tenant): T[]` — 强制 flush 该租户 pending（空则 `[]`）
- `pending(tenant): number` / `peek(tenant): T[]` — 计数与窥视（peek 须返回副本）
- `poll(): Record<string, T[]>` — 扫描所有租户，flush 所有已到期的批次（测试里通常在 `clock.advance` 后调用）
- `exportState()` / `importState(state)` — 崩溃恢复；须保留原始 enqueue 时间戳
- `clearTenant(tenant)` — 清除该租户全部 pending

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` / `src/errors.ts` — pending 项与快照类型
- `src/batch.ts` — 批次大小/到期判定辅助
- `src/store.ts` — 按 tenant 隔离的 pending 存储
- `src/recover.ts` — 快照序列化/恢复
- `src/queue.ts` — `BatchQueue` 门面
- `src/index.ts` — 统一导出

具体行为以 tests 为准。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
