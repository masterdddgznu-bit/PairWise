## 简述

实现进程内半开区间租约表：`acquire` 登记 `[start, end)`；与仍有效租约重叠则入等待队列；`release` 与 `drive`（过期回收后）按 FIFO 把头部分不再重叠的等待者晋升为持有。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SpanLease`，以及错误类 `SpanLeaseError` 和至少 `InvalidConfigError` / `InvalidIdError` / `InvalidRangeError` / `DuplicateIdError` / `CapacityError` / `UnknownTicketError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SpanLease({
  clock,
  maxLeases?: number,
  maxWaiters?: number,
})
```

- `maxLeases` 默认 16、整数 `>= 1`；`maxWaiters` 默认 8、整数 `>= 1`。非法配置抛 `InvalidConfigError`。

区间均为半开 `[start, end)`：`start`/`end` 为有限整数，`0 <= start < end`，且必须 `end > now`（创建时仍可能有效），否则 `InvalidRangeError`。

有效：`now < end`。当 `now === end` 已过期。

重叠：`[a,b)` 与 `[c,d)` 在 `a < d && c < b` 时冲突（因此 `[0,2)` 与 `[2,4)` 不重叠）。

`acquire(id, start, end): { status: 'granted' } | { status: 'waiting'; ticket: number }`

- `id` 非空，否则 `InvalidIdError`；区间非法 → `InvalidRangeError`。
- 若 id 已持有或已在等待队列 → `DuplicateIdError`。
- 若与任一**仍有效**持有租约无重叠：当前持有数已达 `maxLeases` → `CapacityError`；否则立即授予，`granted`。
- 若与任一有效持有重叠：等待人数已达 `maxWaiters` → `CapacityError`；否则入等待队尾，`ticket` 从 1 全局递增，返回 `waiting`。
- `acquire` **不会**自动过期回收（过期仍占着「持有登记」直到 `drive`/`release` 路径清理——见下）。为简化冲突判定：只与 `now < end` 的持有比重叠；已过期未清的持有**不**阻挡新的立即授予，但其登记仍计入 `size()` / `ids()`，直到被清掉。
- 容量：`maxLeases` 按**仍登记的持有**计数（含过期未清）；等待队列另计 `maxWaiters`。

`release(id): boolean`

- 非法 id → `InvalidIdError`。
- 若 id 在持有中：移除该持有，然后按等待晋升规则尝试晋升，返回 `true`。
- 若不在持有中：`false`（不从等待队列移除；等待移除用 `cancelWait`）。

`cancelWait(ticket): boolean`

- 未知 ticket → `UnknownTicketError`。
- 若该 ticket 仍在等待：移除并 `true`；否则 `false`。

`drive(): { expired: string[]; granted: Array<{ id: string; ticket: number }> }`

1. 移除所有已过期持有（`now >= end`），`expired` 为其 id、按首次 acquire 持有序。
2. 然后按等待晋升规则尽量晋升。
3. `granted` 为本轮新晋升的 `{ id, ticket }`，按晋升顺序。

等待晋升不变量（FIFO 严格队头）：

- 仅当队头等待请求与**所有仍有效持有**均不重叠时，才将其晋升为持有（消耗一个 lease 名额；若持有数已达 `maxLeases` 则停止晋升）。
- 晋升后继续看新的队头；若队头仍重叠或容量不足则**停止**（后面的等待者即使可能不重叠也不得插队）。

查询（**不**做过期回收，无副作用）：

- `ids(): string[]` — 仍登记持有（可含过期未清），首次授予序。
- `activeIds(): string[]` — 仅有效持有，首次授予序。
- `waitingTickets(): number[]` — 当前等待 ticket，队头到队尾。
- `size(): number` — 与 `ids().length` 相同口径。
- `rangeOf(id): { start: number; end: number } | null` — 持有中不存在 → `null`；非法 id 抛错；过期未清仍返回原区间。
- `covers(t): string[]` — `t` 须为有限整数，否则 `InvalidRangeError`；返回所有有效且 `start <= t < end` 的持有 id，首次授予序。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
