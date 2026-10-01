请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的多租户 fencing-token 租约池半成品。简单 acquire / release 通常正常；当你把「续租、过期窃取、token 校验、多租户隔离、crash import/export」组合在一起时，会出现不一致。请从租约状态与 token 单调性出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `FencePool`（见 `src/pool.ts` / `src/index.ts`）。核心 API：

- `new FencePool(clock: VirtualClock)`
- `acquire(tenant, resource, ttlMs) -> { token, expiry }` — 资源空闲或已过期时可取得租约；被他人未过期占用时拒绝；过期后可窃取并签发更高 token；同一 tenant 再次 acquire 可视为续租
- `renew(tenant, resource, token, ttlMs)` — token 必须匹配当前有效租约；从**当前时刻**延长 expiry
- `release(tenant, resource, token)` — token 必须匹配
- `holder(tenant, resource)` / `isHeld(tenant, resource)` — 查询当前有效持有者
- `exportState()` / `importState(state)` — crash 恢复；import 后过期租约应可窃取，token 计数器不得倒退

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` / `src/errors.ts` — 租约与错误类型
- `src/token.ts` — 按 tenant+resource 单调递增 fencing token
- `src/lease.ts` — 过期判定与租约记录
- `src/store.ts` — 按 tenant 隔离的租约存储
- `src/recover.ts` — 快照序列化/恢复
- `src/pool.ts` — `FencePool` 门面
- `src/index.ts` — 统一导出

具体行为以 tests 为准。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
