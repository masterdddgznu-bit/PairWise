## 简述

实现进程内多车道信用调度器：任务进入命名车道排队；`drive` 按轮转从各道取队头，但只有信用足够才发放；信用不足会记欠账，后续 grant 先还欠再发新任务；任务也可因等待超时被丢弃。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`DebtLane`，以及错误类 `DebtLaneError` 和至少 `InvalidConfigError` / `InvalidLaneError` / `InvalidTaskError` / `UnknownTaskError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new DebtLane({ clock, waitTimeoutMs, maxQueuePerLane?: number })
```

- `waitTimeoutMs >= 1`；`maxQueuePerLane` 默认 16、`>= 1`。非法配置抛 `InvalidConfigError`。

`ensureLane(laneId): void`

- `laneId` 非空，否则 `InvalidLaneError`。
- 已存在则为 no-op；新建时 `credit = 0`、`debt = 0`、空队列。

`submit(laneId, cost, payload?: unknown): { taskId: number }`

- 未知 lane（未 ensure）→ `InvalidLaneError`。
- `cost` 须为有限整数且 `>= 1`，否则 `InvalidTaskError`。
- 该 lane 队列（仅 waiting）已满 → `InvalidTaskError`。
- 成功：全局递增 `taskId`（从 1）；入该 lane 队尾；`enqueuedAt = now`；状态 `waiting`。

`grant(laneId, amount): void`

- 未知 lane → `InvalidLaneError`。
- `amount` 有限且 `>= 1`，否则 `InvalidLaneError`。
- 先偿还 `debt`：`pay = min(debt, amount)`，`debt -= pay`，`amount -= pay`。
- 剩余全部加到 `credit`。

`drive(): { dispatched: Dispatch[]; timedOut: number[] }`

处理顺序写死：

1. **超时**：所有仍 `waiting` 且 `now - enqueuedAt >= waitTimeoutMs` 的任务改为 `timedout` 并移出队列。`timedOut` 为这些 `taskId` 升序。
2. **轮转发放**：维护 `rrCursor`（laneId 字典序环）。从当前游标起，最多巡一整圈（每个仍存在的 lane 至多尝试一次）：
   - 取该 lane 队头 waiting 任务；
   - 若 `credit >= cost`：扣 `credit -= cost`，任务变 `dispatched`，移出队列，记入 `dispatched`（含 `taskId,laneId,payload,cost`）；游标移到 **下一个** lane（字典序环），并继续巡（已用掉本圈名额的不再访）；
   - 若信用不足：`debt += cost`（累加欠账），**不**出队，游标移到下一 lane，本任务留队头；
   - 若该 lane 无 waiting：只前进游标。
3. 一圈结束后停止（即使还有信用与任务——下一轮 `drive` 再来）。注意：本轮因发放成功而前进的游标要保留到下次。

查询：

- `creditOf(laneId): number` / `debtOf(laneId): number` 未知 lane → `InvalidLaneError`。
- `queueOf(laneId): number[]` waiting 的 taskId 队头到队尾；未知 lane → `InvalidLaneError`。
- `statusOf(taskId): 'waiting' | 'dispatched' | 'timedout'` 未知 → `UnknownTaskError`。
- `lanes(): string[]` 已 ensure 的 laneId 字典序。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
