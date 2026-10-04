## 简述

实现进程内公平并发槽调度器：最多同时占用固定数量的槽；后来者排队；等待越久有效优先级越高；持有槽有租约，到期回收后按规则晋升；队头若长期拿不到槽可被跳过以免饿死后面的人。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`FairSlot`，以及错误类 `FairSlotError` 和至少 `InvalidConfigError` / `InvalidRequestError` / `FenceError` / `UnknownTicketError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new FairSlot({ clock, slots, leaseMs, ageEveryMs, ageBump, skipAfterMs, maxWaiters?: number })
```

- `slots >= 1`；`leaseMs >= 1`；`ageEveryMs >= 1`；`ageBump >= 1`；`skipAfterMs >= 1`；`maxWaiters` 默认 16、`>= 1`。非法配置抛 `InvalidConfigError`。

`request(holderId, opts?: { basePriority?: number })` 返回 `{ status: 'granted'; fence: number; slot: number } | { status: 'waiting'; ticket: number }`。

- `holderId` 非空，否则 `InvalidRequestError`。
- 同一 holder 不能同时持有槽又再 request，也不能重复等待，`InvalidRequestError`。
- 有空闲槽：立即授予。`slot` 取当前空闲槽号中最小者（槽号为 `0 .. slots-1`）。`fence` 全局从 1 递增。`leaseDeadline = now + leaseMs`。
- 无空闲槽：入等待队列。`basePriority` 默认 0、须为有限数。`effectivePriority = basePriority + ageBoost`（初始 `ageBoost = 0`）。入队时记录 `enqueuedAt = now`、`lastAgeAt = now`。队列满 → `InvalidRequestError`。
- `ticket` 全局从 1 递增，仅入队成功时分配。

等待序（晋升与 `waitingTickets` 共用）：`effectivePriority` 降序；同等则 `enqueuedAt` 升序；再同等则 `ticket` 升序。

`heartbeat(holderId, fence): boolean` 匹配持有则续租并 `true`；fence 存在但不匹配 holder/数值 → `FenceError`；不存在 → `false`。

`release(holderId, fence): boolean` 匹配则释放该槽并尝试晋升；不匹配规则同 heartbeat；不存在 `false`。

`cancelWait(holderId, ticket): boolean` 未知 ticket `UnknownTicketError`；不属于该 holder 或已不是 waiting → `false`；移出 `true`。

`drive()`：

1. 回收所有 `now >= leaseDeadline` 的持有（释放槽）。
2. 对每个仍在排队的等待者：当 `now - lastAgeAt >= ageEveryMs` 时，按完整周期次数累加 `ageBoost += ageBump * floor((now - lastAgeAt) / ageEveryMs)`，并把 `lastAgeAt` 推进相应整周期（可一次跨多周期）。
3. 反复晋升：若有空闲槽，按等待序取候选人。若队头（当前序第一）的 `now - enqueuedAt >= skipAfterMs` **且** 其后面仍有等待者，则 **跳过队头**（队头留在队列），改试下一位；否则授予队头。授予后重新取序，直到没空闲槽或无人可授予。被跳过的队头在后续 drive/release 中仍可再被考虑（除非已 cancel）。
4. 返回 `{ expiredFences: number[] }` 本轮因到期回收的 fence 升序。

查询：

- `holderOfSlot(slot): string | undefined`
- `fenceOfSlot(slot): number | undefined`
- `slotOf(holderId): number | undefined` 该 holder 当前占用的槽（无则 `undefined`）。
- `waitingTickets(): number[]` 按晋升序。
- `effectivePriorityOf(ticket): number` 未知 ticket `UnknownTicketError`。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
