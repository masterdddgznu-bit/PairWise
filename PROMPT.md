## 简述

实现进程内环形租约：成员加入后进入环；环非空时始终有一位当前持有者（带 fence 与截止时间）。租约到期不会在 `join`/`renew` 时自动轮转，必须 `drive`；也可由持有者 `yield` 主动交棒给下一位。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`RotLease`，以及错误类 `RotLeaseError` 和至少 `InvalidConfigError` / `InvalidArgError` / `DuplicateMemberError` / `UnknownMemberError` / `FenceError` / `CapacityError` / `NotHolderError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new RotLease({
  clock,
  leaseMs,
  maxMembers?: number,
})
```

- `leaseMs` 整数 `>= 1`；`maxMembers` 默认 16、整数 `>= 1`。
- 非法配置抛 `InvalidConfigError`。
- 初始环为空，无持有者。

`join(member): { status: 'holding'; fence: number } | { status: 'waiting' }`

- `member` 非空字符串，否则 `InvalidArgError`。
- 已在环中 → `DuplicateMemberError`。
- 环人数已达 `maxMembers` → `CapacityError`。
- 加入环尾（FIFO 环序）。
- 若加入前环为空：该成员立刻成为持有者，`fence` 从 1 递增，`deadline = now + leaseMs`，返回 `{ status: 'holding', fence }`。
- 否则返回 `{ status: 'waiting' }`（不抢当前持有）。
- `join` **不会**过期/轮转当前租约。

`leave(member): boolean`

- 未知成员 → `UnknownMemberError`。
- 若离开的是当前持有者：移除后若环仍非空，**立即**把持有交给环上原持有者的下一位（新 fence、新 deadline）；若环空则无持有者。返回 `true`。
- 若离开的是非持有者：仅从环中移除，`true`（环序闭合）。

`renew(member, fence): boolean`

- 未知成员 → `UnknownMemberError`。
- 不是当前持有者 → `NotHolderError`。
- fence 不匹配 → `FenceError`。
- 成功：`deadline = now + leaseMs`，`true`。

`yield(member, fence): { fence: number } | null`

- 未知 → `UnknownMemberError`；非持有者 → `NotHolderError`；fence 错 → `FenceError`。
- 若环中仅自己：保持自己持有，刷新 deadline 与 **新 fence**，返回 `{ fence }`。
- 若有其他人：持有交给环上下一位，返回 `null`（调用方不再持有）。
- 下一位获得新 fence、新 deadline。

`drive(): { rotated: boolean; from: string | null; to: string | null }`

- 若无持有者，或 `now < deadline`：`{ rotated: false, from: null, to: null }`。
- 若已到期：
  - 环仅一人：刷新该人的 fence 与 deadline（视为续租），`rotated: true`，`from`/`to` 均为该成员。
  - 环多人：持有从当前交到下一位，`rotated: true`，填 `from`/`to`。
- 一轮 `drive` 最多轮转 **一次**；新 deadline 从 drive 时刻起算，同轮不会再次到期。
- `join`/`renew`/`yield`/`leave` 都不会顺带扫描到期（`leave`/`yield` 的立即交接除外）。

环上下一位：在当前环序数组中，持有者下标 `i` 的下一位为 `(i+1) % length`（`leave` 后先移除再算下一位时，按下述实现约定：先找到原下一位的 member id，再移除，再授予）。

查询：

- `members(): string[]` 当前环序（加入序，经 leave 闭合后的顺序）。
- `holder(): string | null`
- `fence(): number | null`
- `deadline(): number | null`
- `size(): number`

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
