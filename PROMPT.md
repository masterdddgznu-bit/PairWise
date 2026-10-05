## 简述

实现进程内时间槽填充器：条目只写入当前 open 槽；槽满则拒绝新写入（不自动开下一槽）；槽在时间到达终点或手动 `seal` 后变为 sealed；`take` 只从最老的 sealed 槽按写入序取；推进/封口必须经 `drive` 或 `seal`，`submit`/`take` 不会偷偷封槽。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SlotFill`，以及错误类 `SlotFillError` 和至少 `InvalidConfigError` / `CapacityError` / `UnknownSlotError` / `UnknownItemError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SlotFill({
  clock,
  slotMs,
  maxPerSlot,
  maxSealed?: number,
})
```

- `slotMs` 整数 `>= 1`（每个槽的时长）。
- `maxPerSlot` 整数 `>= 1`（单槽最多条目）。
- `maxSealed` 默认 8、整数 `>= 1`（同时处于 `sealed` 且尚未排空的槽数上限）。
- 非法配置抛 `InvalidConfigError`。
- 初始：槽 `1` 为 `open`，`start = 0`，`end = slotMs`。

`submit(payload): { slotId: number; itemId: number }`

- 只写入**当前 open** 槽。
- 若该槽条目数已达 `maxPerSlot` → `CapacityError`（不分配 itemId）。
- 成功：全局 `itemId` 从 1 递增，追加到该槽写入序尾，返回 `{ slotId, itemId }`。
- `submit` **不会**因 `now >= end` 自动封槽或开新槽。

`seal(): { slotId: number }`

- 将当前 open 槽封为 `sealed`（即使为空）。
- 若封后 `sealed` 未排空槽数将超过 `maxSealed` → `CapacityError`（保持 open 不变）。
- 成功：打开下一槽 `slotId+1`，`start = 旧 end`，`end = start + slotMs`，状态 `open`。
- 空槽被 seal 后立刻视为 `drained`（不计入 sealed 容量）。

`drive(): { sealed: number | null }`

- 仅当当前 open 槽满足 `now >= end`：尝试执行与 `seal` 相同的封口。
- 若因 `maxSealed` 无法封口 → 返回 `{ sealed: null }`，槽仍为 open（之后 `submit` 仍可能因槽满而 CapacityError）。
- 一轮 `drive` 最多封 **一个**槽；时间越过多个 `slotMs` 也不会连封。
- `now < end` → `{ sealed: null }`。
- `submit`/`take` 都不会调用这套逻辑。

`take(): { slotId: number; itemId: number; payload: unknown } | null`

- 在状态为 `sealed` 的槽中选 **最小 slotId**，取其剩余写入序队头。
- 取空后该槽变为 `drained`。
- 无 sealed 可取 → `null`（open 槽不可 take）。

`cancel(itemId): boolean`

- 未知 → `UnknownItemError`。
- 仅当条目仍在 **当前 open** 槽：移除，`true`。
- 已在 sealed/drained 或已 taken → `false`。

查询：

- `currentSlot(): number`
- `statusOfSlot(slotId): 'open' | 'sealed' | 'drained'` 未知 → `UnknownSlotError`。
- `openIds(): number[]` 当前 open 槽内 itemId，写入序。
- `readyCount(): number` 所有 sealed 槽中尚未 take 的条目总数。
- `slotOf(itemId): number` 未知抛错；taken 后仍可知原 slotId。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
