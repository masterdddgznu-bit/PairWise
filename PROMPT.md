## 简述

实现进程内多路信用调度器：全局信用桶按虚拟时钟补充；`request(lane, cost)` 能扣则立刻 ok，否则进入该 lane 的挂起队列；`drive` 补充信用后从轮转指针起公平扫描各 lane 队头并尽量发放。队头信用不够则跳过该 lane（可服务其他更便宜的队头），与「全局单一队列队头阻塞」不同。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`MuxCred`，以及错误类 `MuxCredError` 和至少 `InvalidConfigError` / `InvalidRequestError` / `UnknownLaneError` / `UnknownTicketError` / `CapacityError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new MuxCred({
  clock,
  capacity,
  refillPerMs,
  maxPendingPerLane?: number,
})
```

- `capacity` 整数 `>= 1`；`refillPerMs` 整数 `>= 1`。
- `maxPendingPerLane` 默认 8、整数 `>= 1`。
- 非法配置抛 `InvalidConfigError`。
- 初始 `credits = capacity`，`lastRefillAt = 0`。

补充（在 `request`/`drive`/`credits` 前执行一次）：

- `elapsed = now - lastRefillAt`；若 `elapsed > 0`：`credits = min(capacity, credits + elapsed * refillPerMs)`，然后 `lastRefillAt = now`。

`ensureLane(lane): void`

- `lane` 非空，否则 `InvalidRequestError`。
- 已存在 no-op；新建空挂起队列，并加入 **lane 环序尾**（ensure 先后）。

`request(lane, cost): { status: 'ok' } | { status: 'pending'; ticket: number }`

- 非法 lane 名 / `cost` 非有限整数或 `< 1` → `InvalidRequestError`。
- 未知 lane → `UnknownLaneError`。
- 先 refill。
- 若 `credits >= cost`：扣 `credits -= cost`，该 lane `grantedCount += 1`，返回 `{ status: 'ok' }`。
- 否则若该 lane 挂起数已达 `maxPendingPerLane` → `CapacityError`。
- 否则入该 lane 挂起队列尾，`ticket` 全局从 1 递增，记录 `cost`，返回 `{ status: 'pending'; ticket }`。
- `request` **不会**发放其他已挂起请求（不自动 drain）。

`cancel(ticket): boolean`

- 未知 ticket → `UnknownTicketError`。
- 仍在某 lane 挂起队列：移除，`true`。
- 已发放（ok）或不在队列 → `false`。

`drive(): { granted: number[] }`

1. refill。
2. 若无 lane → `{ granted: [] }`。
3. 从**当前轮转指针**起，在 lane 环序上反复扫描：
   - 找一个「队头存在且 `credits >= 队头 cost`」的 lane；发放队头（扣信用、`grantedCount++`、ticket 记入 `granted`），指针移到该 lane 的下一位。
   - 若一圈内找不到可发放队头 → 停止。
   - 成功发放后继续（可连续发放），直到一圈扫不到为止。
4. 返回本轮 `granted`（发放顺序）。
5. 注意：**跳过**队头太贵的 lane，去看后面的 lane（与严格全局队头阻塞相反）。
6. `request`/`cancel` 都不会执行发放循环。

初始指针：第一个 ensure 的 lane；无 lane 时指针为 null。

查询：

- `credits(): number` 先 refill 再返回。
- `lanes(): string[]` 环序。
- `pendingTickets(lane): number[]` FIFO；未知抛错。
- `grantedCount(lane): number` 累计立刻 ok + drive 发放次数；未知抛错。
- `cursor(): string | null` 下一轮 drive/扫描起点。
- `pendingCount(): number` 所有 lane 挂起总数。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
