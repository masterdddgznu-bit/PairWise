## 简述

实现进程内溢流队列：主队列有空位则入主队列；满则进溢流。溢流条目在停留足够久后，必须经 `drive` 按批回灌主队列。`take` 只从主队列取头，不会偷偷回灌。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SpillQ`，以及错误类 `SpillQError` 和至少 `InvalidConfigError` / `InvalidEnqueueError` / `CapacityError` / `UnknownItemError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SpillQ({
  clock,
  maxPrimary,
  maxOverflow,
  holdMs,
  promoteBatch?: number,
})
```

- `maxPrimary` 整数 `>= 1`；`maxOverflow` 整数 `>= 1`；`holdMs` 整数 `>= 1`。
- `promoteBatch` 默认 1、整数 `>= 1`（一轮 `drive` 最多从溢流回灌多少条）。
- 非法配置抛 `InvalidConfigError`。

`enqueue(payload): { itemId: number; lane: 'primary' | 'overflow' }`

- 全局 `itemId` 从 1 递增。
- 若主队列长度 `< maxPrimary`：进入主队列尾，`lane: 'primary'`。
- 否则若溢流长度 `< maxOverflow`：进入溢流尾，记下 `spilledAt = now`，`lane: 'overflow'`。
- 否则 `CapacityError`（不分配 itemId）。
- `enqueue` **不会**把溢流回灌到主队列。

`drive(): { promoted: number[] }`

1. 仅当主队列仍有空位。
2. 溢流中 `now >= spilledAt + holdMs` 的条目，按 `spilledAt` 升序，再 `itemId` 升序，视为到期。
3. 按该顺序最多回灌 `promoteBatch` 条（且不超过主队列剩余空位）：从溢流移除，进入主队列尾。
4. 未到期或排在后面的留在溢流。
5. 返回本轮回灌的 `itemId` 列表（回灌顺序）。

`take(): { itemId: number; payload: unknown } | null`

- 只取 **主队列** 队头；成功后该条离开系统。
- 主队列空 → `null`（即使溢流里已有到期条目）。
- `take` **不会**回灌。

`cancel(itemId): boolean`

- 未知 → `UnknownItemError`。
- 在主队列或溢流中：移除，`true`。
- 已被 take → `false`。

查询：

- `primaryIds(): number[]` 主队列 FIFO。
- `overflowIds(): number[]` 溢流 FIFO（入溢流顺序）。
- `statusOf(itemId): 'primary' | 'overflow' | 'taken'` 未知抛错。
- `primaryCount()` / `overflowCount()`

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
