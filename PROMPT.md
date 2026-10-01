请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的多租户幂等去重日志半成品。简单 accept / has 通常正常；当你把「TTL 边界、重复 ingest 不续期、租户隔离、GC 与 size、export/import 恢复」组合在一起时，会出现不一致。请从记录时间与过期判定出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `DedupLog`（见 `src/log.ts` / `src/index.ts`）。核心 API：

- `new DedupLog(clock: VirtualClock, opts: { ttlMs })`
- `accept(tenant, id): boolean` — 首次未过期记录返回 true；未过期重复返回 false；过期后可再次 accept
- `has(tenant, id): boolean` — 存在未过期记录时为 true
- `seenAt(tenant, id): number | undefined` — 未过期记录的 ingest 时刻
- `gc()` — 清除过期项；accept/has 等也会惰性 GC
- `clearTenant(tenant)` / `size(tenant?)` — 租户清理与计数
- `exportState()` / `importState(state)` — 崩溃恢复；import 后须尊重当前 clock，不得把已过期记录当存活

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` / `src/errors.ts` — 记录与快照类型
- `src/entry.ts` — 过期判定辅助
- `src/store.ts` — 按 tenant 隔离的条目存储与 GC
- `src/recover.ts` — 快照序列化/恢复
- `src/log.ts` — `DedupLog` 门面
- `src/index.ts` — 统一导出

具体行为以 tests 为准。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
