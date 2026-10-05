## 简述

实现进程内带闸门的双区缓冲：闸门开启时 `write` 进主队列，关闭时进 park；`open` 与到期/`drive` 在**搬运配额**约束下把 park 按序灌回主队列；主队列满或配额用尽则剩余留在 park。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`GateBuf`，以及错误类 `GateBufError` 和至少 `InvalidConfigError` / `InvalidIdError` / `DuplicateIdError` / `CapacityError` / `GateStateError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new GateBuf({
  clock,
  maxMain,
  maxPark,
  autoOpenMs,
  transferQuota,
})
```

- `maxMain` / `maxPark` / `autoOpenMs` / `transferQuota` 均为整数 `>= 1`。
- 非法配置抛 `InvalidConfigError`。
- 初始闸门 **开启**；`closedAt` 为 `null`；当前搬运剩余配额为 `0`（尚未授予）。

id 在主队列与 park 中全局唯一（两区合计不可重复）。

`write(id, payload): { status: 'main' | 'parked' }`

- `id` 非空，否则 `InvalidIdError`。
- 若 id 已在主队列或 park → `DuplicateIdError`。
- 闸门开启：主队列已满 → `CapacityError`；否则入主队列尾，`{ status: 'main' }`。
- 闸门关闭：park 已满 → `CapacityError`；否则入 park 尾，`{ status: 'parked' }`。
- 开启时不得写入 park；关闭时不得写入主队列。
- `write` **不会**自动开闸或搬运。

`read(): { id: string; payload: unknown } | null`

- 只从主队列头取出；空则 `null`。与闸门开关无关。

`cancel(id): boolean`

- 非法 id → `InvalidIdError`。
- 从主队列或 park 移除（先主后 park），成功 `true`；都不在 `false`。

`close(): boolean`

- 若已关闭 → `false`。
- 否则关闭闸门，`closedAt = now`，当前搬运剩余配额清零，`true`。

`open(): { transferred: number }`

- 若已开启：仍授予一整份 `transferQuota` 为本次剩余配额，再搬运，返回本次搬运条数。
- 若关闭：先开启（`closedAt = null`），再同样授予配额并搬运。
- 搬运不变量：按 park 首次写入序，每次移动一条到主队列尾，直到 park 空、主队列满、或本次剩余配额为 0；每成功一条消耗 1 配额。
- `transferred` 为本次成功移入主队列的条数。

`drive(): { opened: boolean; transferred: number }`

- 若闸门关闭且 `now >= closedAt + autoOpenMs`：执行与 `open()` 相同的开闸+授配额+搬运，返回 `{ opened: true, transferred }`。
- 否则若闸门已开启：授予一整份 `transferQuota` 并搬运（不改变 open 状态），返回 `{ opened: false, transferred }`。
- 否则（仍关闭且未到期）：`{ opened: false, transferred: 0 }`，不授配额、不搬运。
- `write`/`read`/`cancel`/`close` **不会**调用这套自动逻辑。

查询（无副作用）：

- `isOpen(): boolean`
- `mainIds(): string[]` / `parkIds(): string[]` — 各区首次写入序
- `mainSize()` / `parkSize()`
- `closedAt(): number | null`
- `quotaRemaining(): number` — 当前尚未用完的搬运配额

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
