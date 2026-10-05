## 简述

实现进程内可老化优先级队列：入队带初始优先级；`take` 取当前最高优先级（同优先级再比入队时间与 id）；条目在队列中停留足够久后，必须经 `drive` 才能把优先级 +1（有上限，且一轮每条最多升一级）。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`RankQ`，以及错误类 `RankQError` 和至少 `InvalidConfigError` / `InvalidEnqueueError` / `CapacityError` / `UnknownItemError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new RankQ({
  clock,
  maxSize,
  ageMs,
  maxPriority,
  ageBatch?: number,
})
```

- `maxSize` 整数 `>= 1`（队列中未 take 的条目上限）。
- `ageMs` 整数 `>= 1`（距上次「优先级生效时刻」达到该值才可老化）。
- `maxPriority` 整数 `>= 0`（优先级上限；入队优先级也不得超过它）。
- `ageBatch` 默认不限制（可用 `Infinity` 语义：一轮可老化所有到期者）；若给出须为整数 `>= 1`。
- 非法配置抛 `InvalidConfigError`（`ageBatch` 若传入非整数或 `< 1` 也非法；省略则表示不限制）。

`enqueue(payload, priority): { itemId: number }`

- `priority` 须为有限整数且 `0 <= priority <= maxPriority`，否则 `InvalidEnqueueError`。
- 当前队列长度已达 `maxSize` → `CapacityError`。
- 成功：全局 `itemId` 从 1 递增；`enqueuedAt = now`；`priority` 为给定值；`rankAt = now`（「当前优先级开始生效」的时刻，用于老化计时）；状态 `queued`。

取出序（`take` 与 `peekIds` 共用）：

1. `priority` **降序**（更大优先）；
2. 同等则 `enqueuedAt` 升序；
3. 再同等 `itemId` 升序。

`take(): { itemId: number; priority: number; payload: unknown } | null`

- 按取出序取队头；成功后状态 `taken`，离开队列。
- 空 → `null`。
- `take` **不会**执行老化。

`drive(): { aged: number[] }`

1. 找出所有仍 `queued` 且 `priority < maxPriority` 且 `now >= rankAt + ageMs` 的条目。
2. 将这些候选按取出序（用**当前** priority）排列。
3. 若配置了有限 `ageBatch`，只取前 `ageBatch` 条；否则全部。
4. 对选中的每条：`priority += 1`，`rankAt = now`（重新开始计时；同一轮不会因新 `rankAt` 再升）。
5. 返回本轮实际提升的 `itemId`（按处理顺序）。

`cancel(itemId): boolean`

- 未知 → `UnknownItemError`。
- `queued`：移除，`true`。
- `taken`：`false`。

查询：

- `peekIds(): number[]` 当前 queued，按取出序。
- `priorityOf(itemId): number` 未知抛错；taken 仍可查最后优先级。
- `size(): number` 仅 queued。
- `statusOf(itemId): 'queued' | 'taken'` 未知抛错。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
