## 简述

实现进程内世代排水队列：生产者入队；消费者按租约领取；ack 完成、nack 回到排队或进隔离；开启 drain 后旧世代只出不进，新世代另起；超时未 ack 的领取自动回收。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`DrainQ`，以及错误类 `DrainQError` 和至少 `InvalidConfigError` / `InvalidEnqueueError` / `InvalidLeaseError` / `UnknownItemError` / `FenceError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new DrainQ({ clock, leaseMs, maxInflight?: number, maxQuarantine?: number })
```

- `leaseMs >= 1`；`maxInflight` 默认 8、`>= 1`；`maxQuarantine` 默认 8、`>= 1`。非法配置抛 `InvalidConfigError`。

内部世代：从 1 开始。状态分 `running` / `draining`。

`enqueue(payload: unknown, opts?: { generation?: number }): { itemId: number; generation: number }`

- 分配全局递增 `itemId`（从 1）。
- 默认写入 **当前写入世代** `writeGen`：
  - `running` 时 `writeGen === activeGen`；
  - `draining` 时 `writeGen === activeGen + 1`（新世代），旧世代不再接受默认入队。
- 若显式 `generation`：必须等于当前允许写入的世代（running 时只能 `activeGen`；draining 时只能 `activeGen + 1`），否则 `InvalidEnqueueError`。
- 返回实际 `generation`。

`lease(consumerId): { itemId: number; fence: number; generation: number; payload: unknown } | null`

- `consumerId` 非空，否则 `InvalidLeaseError`。
- 当前 inflight 数（所有 consumer 合计）已达 `maxInflight` → `null`。
- 取排队中 **最小 itemId** 且其 `generation === activeGen` 的条目（drain 期间仍只从 `activeGen` 取；新世代排队但不可 lease，直到 `finishDrain`）。
- 成功：状态 `leased`，`fence` 全局从 1 递增，`deadline = now + leaseMs`，记录 `consumerId`；从排队移除。

`ack(consumerId, itemId, fence): boolean`

- 未知 item → `UnknownItemError`。
- fence 不匹配 → `FenceError`。
- 非该 consumer 的 leased → `false`。
- 成功：状态 `done`，释放 inflight，`true`。

`nack(consumerId, itemId, fence, opts?: { quarantine?: boolean }): boolean`

- 未知 `UnknownItemError`；fence 错 `FenceError`；非 leased/非该 consumer → `false`。
- `quarantine === true`：若隔离区已满 → `InvalidLeaseError`（保持 leased 不变）；否则进隔离 `quarantined`，释放 inflight。
- 否则：回到该世代排队（仍按 itemId 排序），状态 `queued`，释放 inflight。

`beginDrain(): number`

- 已在 `draining` → `InvalidEnqueueError`。
- 进入 `draining`；返回即将承接新写入的世代 `activeGen + 1`（不立即切换 active）。

`finishDrain(): boolean`

- 不在 draining → `false`。
- 仅当 `activeGen` 已无 `queued`/`leased` 条目（`done`/`quarantined` 可忽略）→ 将 `activeGen` 增 1，状态回 `running`，`true`。
- 否则 `false`（仍 draining）。

`requeueQuarantine(itemId): boolean`

- 未知 `UnknownItemError`。
- 非 quarantined → `false`。
- 成功：回到其原 generation 排队，`true`。若该 generation 已小于 `activeGen`（已被 finish 甩在后面）→ `InvalidEnqueueError`。

`drive(): { expired: number[] }`

1. 所有 `leased` 且 `now >= deadline` 的条目：自动按 **非隔离 nack** 回收回排队（同一 generation）。
2. 返回本轮回收的 `itemId` 升序。

查询：

- `statusOf(itemId): 'queued' | 'leased' | 'done' | 'quarantined'` 未知 `UnknownItemError`。
- `activeGeneration(): number`
- `writeGeneration(): number` running 时等于 active；draining 时为 active+1。
- `mode(): 'running' | 'draining'`
- `queuedIds(generation?: number): number[]` 默认 activeGen；升序。
- `inflightIds(): number[]` 升序。
- `quarantineIds(): number[]` 升序。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
