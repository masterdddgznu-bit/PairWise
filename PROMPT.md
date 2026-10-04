## 简述

实现进程内按 key 持有：无人持有则立即授予 fence；已被他人持有则进入该 key 的等待队列。`release` 立刻把持有转给队头等待者（若有）。租约到期不会在 `pin`/`renew` 时自动失效，必须 `drive` 过期后再转交。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`HoldPin`，以及错误类 `HoldPinError` 和至少 `InvalidConfigError` / `InvalidArgError` / `DuplicateHoldError` / `FenceError` / `UnknownKeyError` / `UnknownTicketError` / `CapacityError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new HoldPin({
  clock,
  leaseMs,
  maxWaitersPerKey?: number,
})
```

- `leaseMs` 整数 `>= 1`；`maxWaitersPerKey` 默认 8、整数 `>= 1`。
- 非法配置抛 `InvalidConfigError`。

`pin(key, holder): { status: 'held'; fence: number } | { status: 'waiting'; ticket: number }`

- `key`、`holder` 均须非空字符串，否则 `InvalidArgError`。
- 若该 holder **已经持有该 key** → `DuplicateHoldError`（即便租约墙钟已过期，只要尚未 `drive`）。
- 若该 holder 已在该 key 等待队列中 → `DuplicateHoldError`。
- 若当前无人持有：授予持有，`fence` 全局从 1 递增，`deadline = now + leaseMs`，返回 `{ status: 'held', fence }`。
- 若已有他人持有：等待人数已达 `maxWaitersPerKey` → `CapacityError`；否则入队尾，`ticket` 全局从 1 递增，返回 `{ status: 'waiting', ticket }`。
- `pin` **不会**过期当前持有。

`renew(key, holder, fence): boolean`

- 从未出现过的 key → `UnknownKeyError`。
- fence 不匹配当前持有 → `FenceError`。
- 不是当前 holder → `false`。
- 成功：`deadline = now + leaseMs`，`true`。

`release(key, holder, fence): boolean`

- 未知 key → `UnknownKeyError`；fence 不匹配当前持有 → `FenceError`；不是当前 holder → `false`。
- 成功释放当前持有：若该 key 等待队列非空，**立即**把队头变成新持有者（新 fence、新 deadline），`true`；若无等待者，key 变为空闲，`true`。

`cancelWait(ticket): boolean`

- 未知 ticket → `UnknownTicketError`。
- 仍在某 key 等待队列：移除，`true`。
- 已升为持有或已不在队列 → `false`。

`drive(): { expired: string[]; granted: string[] }`

1. 所有仍被持有且 `now >= deadline` 的 key：当前 holder 失去持有（记入 `expired`，key 字典序）。
2. 对每个刚过期的 key：若仍有等待者，立即授予队头（记入 `granted`，字典序）；否则保持空闲。
3. 一轮 `drive` 只处理**当前已经到期**的持有；新授予的 deadline 从 **drive 时刻**起算，不会在同一轮里再次过期。
4. `pin`/`renew`/`release` 都不会顺带扫描过期。

查询：

- `holderOf(key): string | null` 空闲或未知 key → `null`（非法 key 仍 `InvalidArgError`）。
- `fenceOf(key): number | null` 无当前持有 → `null`。
- `deadlineOf(key): number | null`
- `waiterTickets(key): number[]` FIFO；未知 key → `[]`。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
