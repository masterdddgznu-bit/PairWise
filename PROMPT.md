## 简述

实现进程内区间占有器：对半开区间 `[lo, hi)` 做排他持有；与他人区间重叠则排队，仅相邻相接不算重叠；释放或到期后把「此刻已不再重叠」的等待者按规则晋升，仍重叠的留在队列。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SpanOwn`，以及错误类 `SpanOwnError` 和至少 `InvalidConfigError` / `InvalidAcquireError` / `FenceError` / `UnknownTicketError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SpanOwn({ clock, leaseMs, maxWaiters?: number })
```

- `leaseMs >= 1`；`maxWaiters` 默认 8、`>= 1`。非法配置抛 `InvalidConfigError`。

区间：半开 `[lo, hi)`，`lo`/`hi` 须为有限数且 `lo < hi`。两区间重叠当且仅当 `lo < otherHi && hi > otherLo`（因此 `[0,2)` 与 `[2,4)` 不重叠）。

`acquire(holderId, lo, hi, opts?: { priority?: number })` 返回 `{ status: 'granted'; fence: number } | { status: 'waiting'; ticket: number }`。

- `holderId` 非空。非法区间或空 id → `InvalidAcquireError`。
- 与 **自己已持有** 的任一区间重叠 → `InvalidAcquireError`（不能叠自己的锁；应另选空隙或先释放）。
- 已在等待同一 `(lo, hi)`（精确相等）→ `InvalidAcquireError`。
- 与 **他人** 已持有区间无重叠：立即授予。`fence` 全局从 1 递增（与区间端点无关）。`leaseDeadline = now + leaseMs`。
- 与他人重叠：入全局等待队列。`priority` 默认 0、越大越优先；同等 priority 按入队时刻升序，再按 `ticket` 升序。队列满 → `InvalidAcquireError`。
- `ticket` 全局从 1 递增，仅入队成功时分配。
- 同一 holder 可以同时持有多段 **互不重叠** 的区间。

`heartbeat(holderId, fence): boolean` 匹配该笔持有则续租并 `true`；fence 存在但不属于该 holder 或数值不匹配 → `FenceError`；根本没有这笔 fence → `false`。

`release(holderId, fence): boolean` 匹配则释放并尝试晋升；fence 错（存在但不匹配）`FenceError`；不存在 `false`。

`cancelWait(holderId, ticket): boolean` 未知 ticket `UnknownTicketError`；不属于该 holder 或已不是 waiting → `false`；移出队列 `true`。

`drive()`：

1. 回收所有 `now >= leaseDeadline` 的持有。
2. 无论有无到期，都按等待序反复晋升：队中请求若与 **当前任意持有** 无重叠则授予（新 fence、新 deadline），有重叠则跳过并留在队列。一轮从前往后，授予后重新取序，直到无人可授予。
3. 返回 `{ expiredFences: number[] }` 本轮到期回收的 fence 升序。

查询：

- `ownerAt(x: number): string | undefined` 覆盖 `x` 的持有者（`lo <= x < hi`）；无则 `undefined`。
- `holdsOf(holderId): { lo: number; hi: number; fence: number }[]` 按 `lo` 升序，`lo` 相同按 `fence` 升序。
- `waitingTickets(): number[]` 当前仍在排队的 ticket，按晋升序。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
