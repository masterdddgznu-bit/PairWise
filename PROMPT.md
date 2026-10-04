## 简述

实现进程内按 key 合并的执行器：同一 key 同时至多一名 leader 在跑；后来者排队；leader 提交的结果（成功或失败）在 TTL 内可被新请求直接命中；leader 租约到期不会把失败塞给等待者，而是按规则把队列里的人晋升成新 leader。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`LeadKey`，以及错误类 `LeadKeyError` 和至少 `InvalidConfigError` / `InvalidStartError` / `FenceError` / `UnknownTicketError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new LeadKey({ clock, leaseMs, cacheMs, maxWaitersPerKey?: number })
```

- `leaseMs >= 1`；`cacheMs >= 1`；`maxWaitersPerKey` 默认 8、`>= 1`。非法配置抛 `InvalidConfigError`。

`start(holderId, key)` 返回三者之一：

- `{ status: 'cached'; ok: boolean; value: unknown }` 该 key 仍有未到期缓存（成功、失败都算缓存）。
- `{ status: 'leader'; fence: number }` 成为该 key 当前 leader（`fence` 对该 key 从 1 递增）。
- `{ status: 'waiting'; ticket: number }` 已有他人做 leader，进入该 key 等待队列。

硬规则：

- `holderId` / `key` 非空，否则 `InvalidStartError`。
- 同一 `(holderId, key)` 不能同时既是 leader 又再 start，也不能重复等待，`InvalidStartError`。
- 有有效缓存时 **一律返回 cached**，即使该 key 上还有未 poll 的旧 ticket。
- 无缓存且无 leader：授予 leader，`leaseDeadline = now + leaseMs`。
- 无缓存且已有 leader：入队。`priority` 不在 start 参数里（一律 0）；同等条件下按入队时刻升序，再按 `ticket` 升序。队列满 → `InvalidStartError`。
- `ticket` 全局从 1 递增，仅成功入队时分配。

`poll(holderId, ticket)`：

- 未知 ticket → `UnknownTicketError`。
- ticket 不属于该 holder → 返回 `{ status: 'foreign' }`。
- 仍在队列 → `{ status: 'waiting' }`。
- 已被晋升为该 key 的新 leader（尚未 complete）→ `{ status: 'leader'; fence: number }`（可重复 poll，直到 complete 或该次领导权因到期被拿走）。
- leader 已 `complete` 且该 ticket 应拿到结果 → `{ status: 'done'; ok: boolean; value: unknown }`。**第一次**以 done 返回后票作废，再次 poll 同一 ticket → `UnknownTicketError`。

`complete(holderId, key, fence, ok: boolean, value: unknown): boolean`

- 必须是该 key **当前** leader 且 fence 匹配：写入缓存（`expireAt = now + cacheMs`，成功失败都写），卸任 leader；当时仍在队列里的等待者全部改为待领取的 done（同一 `ok`/`value`）。返回 `true`。
- fence 与当前 leader 不一致 → `FenceError`。
- 根本不是当前 leader → `false`（不抛 `FenceError`）。

`heartbeat(holderId, key, fence): boolean` 匹配则续租 `leaseDeadline = now + leaseMs` 并 `true`；fence 不匹配 `FenceError`；不是当前 leader `false`。

`cancelWait(holderId, ticket): boolean`

- 未知 ticket `UnknownTicketError`。
- 不属于该 holder、或已不是排队中的 waiting（已晋升 / 已 done）→ `false`。
- 成功移出队列 `true`。

`drive()`：

1. 丢掉所有 `now >= expireAt` 的缓存。
2. 丢掉所有 `now >= leaseDeadline` 的 leader（**不要**给他们的等待者写入失败缓存或 done）。
3. 对当前 **没有 leader** 的 key，按等待序把队头晋升为新 leader（新 fence、新 deadline）。其余人留在队列。
4. 返回 `{ expiredLeaders: string[]; expiredCache: string[] }`，均为 key 字典序。

查询：

- `leaderOf(key): string | undefined`
- `fenceOf(key): number | undefined` 当前 leader 的 fence（无 leader 则 `undefined`，缓存不占用 fence）。
- `waitingTickets(key): number[]` 仍在排队（不含已晋升未 complete、不含待领取 done）按晋升序。
- `cachedOf(key): { ok: boolean; value: unknown } | undefined` 仅未到期缓存。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
