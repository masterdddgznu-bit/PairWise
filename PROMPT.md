## 简述

实现进程内延迟袋：`schedule` 投入尚未就绪的条目；时间到达后必须经 `drive` 晋级到就绪队列；`take` 只从就绪队列按晋级顺序取出；待晋级与就绪各有容量上限；可取消未取走的条目。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`DelayBag`，以及错误类 `DelayBagError` 和至少 `InvalidConfigError` / `InvalidScheduleError` / `CapacityError` / `UnknownTicketError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new DelayBag({
  clock,
  maxPending?: number,
  maxReady?: number,
})
```

- `maxPending` 默认 16、整数 `>= 1`（状态为 `pending` 的条目数上限）。
- `maxReady` 默认 16、整数 `>= 1`（状态为 `ready` 的条目数上限）。
- 非法配置抛 `InvalidConfigError`。

`schedule(payload, delayMs): { ticket: number }`

- `delayMs` 须为有限整数且 `>= 0`，否则 `InvalidScheduleError`。
- 当前 `pending` 数已达 `maxPending` → `CapacityError`。
- 成功：全局 `ticket` 从 1 递增；`readyAt = now + delayMs`；状态 `pending`。
- **即使 `delayMs === 0`，也不会立刻变成可 take**；必须之后 `drive` 晋级。

`drive(): { promoted: number[] }`

1. 找出所有 `pending` 且 `now >= readyAt` 的条目，按 `readyAt` 升序，再 `ticket` 升序。
2. 按该顺序尽量晋级为 `ready`：每晋级一条计入本轮 `promoted`；若就绪数已达 `maxReady`，**停止**（后续虽已到期仍保持 `pending`，等就绪有空位后再 `drive`）。
3. 返回本轮新晋级的 `ticket` 列表（晋级顺序）。

`take(): { ticket: number; payload: unknown } | null`

- 只从 `ready` 队列取队头（晋级顺序，FIFO）。
- 成功后状态 `taken`；无 ready → `null`。
- `take` **不会**把到期的 `pending` 偷偷晋级。

`cancel(ticket): boolean`

- 未知 ticket → `UnknownTicketError`。
- `pending` 或 `ready`：移除（释放对应容量），`true`。
- `taken`：`false`。

查询：

- `statusOf(ticket): 'pending' | 'ready' | 'taken'`，未知 → `UnknownTicketError`。
- `pendingTickets(): number[]` 当前 pending，按 `readyAt` 再 `ticket` 升序。
- `readyTickets(): number[]` 当前 ready，按晋级顺序（与 take 一致）。
- `pendingCount(): number` / `readyCount(): number`

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
