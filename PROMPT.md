请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的多租户滑动窗口限流半成品。简单 allow / check 通常正常；当你把「窗口边界、burst 与 refill、check 无副作用、租户隔离、GC 与 export/import 恢复」组合在一起时，会出现不一致。请从事件时间轴与窗口计数出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `RateLimiter`（见 `src/limiter.ts` / `src/index.ts`）。核心 API：

- `new RateLimiter(clock: VirtualClock, opts: { windowMs, limit })`
- `allow(tenant, key): boolean` — 当前滑动窗口 `[now - windowMs, now]` 内未超限则记录一次并返回 true，否则 false
- `check(tenant, key): { allowed, remaining, resetAt }` — 窥视当前窗口状态，不得改变计数（以 tests 为准）
- `reset(tenant, key)` / `clearTenant(tenant)` — 清除计数
- `exportState()` / `importState(state)` — 崩溃恢复；恢复后继续使用时应 GC 过期事件

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` / `src/errors.ts` — 事件与快照类型
- `src/window.ts` — 窗口内计数、remaining、resetAt
- `src/store.ts` — 按 tenant+key 隔离的事件存储与 GC
- `src/recover.ts` — 快照序列化/恢复
- `src/limiter.ts` — `RateLimiter` 门面
- `src/index.ts` — 统一导出

滑动窗口以 `VirtualClock.now()` 为右端点；事件是否计入窗口、remaining 与 resetAt 的计算方式以 tests 为准。

具体行为以 tests 为准。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
