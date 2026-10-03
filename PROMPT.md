请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的 **层级时间轮（timing wheel）租约管理** 半成品。短 TTL、单次 schedule/cancel 的常见路径通常正常；把「槽位回绕、同一 leaseId 续约、取消后残留、一次 advance 跨越多个 tick、同一槽多租约、到期顺序」组合起来会出现不一致。请从时钟推进与槽位索引出发定位，而不是只改一处表面分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止真实网络、数据库、`setTimeout`/`Math.random`；时间只通过 `VirtualClock` 推进。

## 期望语义（以 tests 为准）

构造：`new LeaseWheel({ clock, slotCount, tickMs })`
- `slotCount >= 2`，`tickMs >= 1`，否则 `InvalidConfigError`。

API：
- `schedule(leaseId, ttlMs, payload)`：在 `now + ttlMs` 到期。`ttlMs >= 1`。若 `leaseId` 已存在且未到期，视为**续约**（取消旧挂载再挂新到期）。已到期未 poll 走的 id 也可重新 schedule。
- `cancel(leaseId): boolean`：取消未到期租约；不存在或已到期返回 `false`。
- `drive()`：根据 `clock.now()` 相对上次驱动时间，推进整 tick 数；把经过的槽位中到期的租约移入到期队列。不足一个 tick 的时间累积到下次。
- `pollExpired(): Array<{ leaseId, payload, expireAt }>`：按到期时间升序、同一时间按 `leaseId` 字典序取出并清空到期队列。
- `has(leaseId)` / `size()`（未到期数量）/ `pendingExpired()`（待 poll 数量）。

到期时刻：`expireAt = schedule时刻的 clock.now() + ttlMs`。租约在 `clock.now() >= expireAt` 之后应能被 `drive` 收割（边界上 `now == expireAt` 算到期）。

模块：`clock` / `types` / `errors` / `slots` / `wheel` / `leases` / `leasewheel` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
