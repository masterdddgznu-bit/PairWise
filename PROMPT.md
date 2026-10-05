## 简述

实现进程内固定槽位数租约池：持有带 fence/deadline；满员进入 FIFO 等待；释放立刻把该槽授予队头；到期不会在 acquire/renew 时自动失效，必须 drive。授予时优先复用 holder 的亲和槽，否则取最小空闲槽。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`LeaseBank`，以及错误类 `LeaseBankError` 和至少 `InvalidConfigError` / `InvalidArgError` / `InvalidSlotError` / `DuplicateError` / `FenceError` / `UnknownTicketError` / `CapacityError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new LeaseBank({
  clock,
  slots,
  leaseMs,
  maxWaiters?: number,
})
```

- `slots` 整数 `>= 1`（槽编号 `0 .. slots-1`）。
- `leaseMs` 整数 `>= 1`。
- `maxWaiters` 默认 8、整数 `>= 1`。
- 非法配置抛 `InvalidConfigError`。
- 全局 `fence` 与 `ticket` 均从 1 递增。
- 宜拆成多模块（槽表、等待队列、亲和映射），具体文件划分自定。

**亲和性（sticky）**

- 每当 holder 成功获得某槽（acquire 立刻 held，或 release/drive 晋升授予），将该 holder 的亲和槽记为该槽。
- `preferredSlot(holder)`：返回当前亲和槽，无记录 → `null`；`holder` 非法 → `InvalidArgError`。
- `clearAffinity(holder): boolean`：清除亲和；非法 holder 抛错；有记录清除返回 `true`，否则 `false`。
- 选槽规则：若亲和槽存在且当前空闲，授予该槽；否则授予**编号最小**的空闲槽。
- `release` 把**刚刚释放的那个槽**交给队头（不走亲和选槽）；被授予者更新亲和为该槽。
- `drive` 过期后从等待队列晋升时，**走亲和选槽**（亲和优先，否则最小空闲）。
- 过期或主动释放**不**自动清除亲和；仅 `clearAffinity` 或 holder 后来获得另一槽时覆盖。

`acquire(holder): { status: 'held'; slot: number; fence: number } | { status: 'waiting'; ticket: number }`

- `holder` 非空字符串，否则 `InvalidArgError`。
- 若该 holder **已持有任一槽**（即便墙钟已过期，只要尚未 `drive`）→ `DuplicateError`。
- 若该 holder 已在等待队列 → `DuplicateError`。
- 若存在空闲槽：按亲和选槽授予，`fence` 递增，`deadline = now + leaseMs`，更新亲和，返回 held。
- 否则：等待人数已达 `maxWaiters` → `CapacityError`；否则入队尾，`ticket` 递增，返回 waiting。
- `acquire` **不会**过期任何租约，也**不会**自动晋升等待者（除非因空闲槽立刻 held）。

`renew(slot, holder, fence): boolean`

- 非法 slot → `InvalidSlotError`。
- 槽空闲 → `false`。
- fence 不一致 → `FenceError`。
- holder 不是当前持有者 → `false`。
- 成功：`deadline = now + leaseMs`，亲和保持/写回该槽，`true`。
- `renew` **不会**过期其它槽。

`release(slot, holder, fence): boolean`

- 非法 slot → `InvalidSlotError`。
- 槽空闲 → `false`。
- fence 不一致 → `FenceError`。
- holder 不匹配 → `false`。
- 成功释放：若等待队列非空，**立刻**把队头授予**刚刚释放的这个 slot**（新 fence、新 deadline、更新被授予者亲和），`true`；若无等待者，槽变空闲，原 holder 亲和保留，`true`。

`cancelWait(ticket): boolean`

- 从未出现过的 ticket → `UnknownTicketError`。
- 仍在等待队列：移除，`true`。
- 已获持有或已不在队列 → `false`。

`drive(): { expired: number[]; granted: Array<{ slot: number; holder: string; fence: number }> }`

1. 将所有 `now >= deadline` 的持有槽清空，`expired` 为这些槽编号的**升序**（亲和保留）。
2. 然后反复：若有空闲槽且等待队列非空，把队头按**亲和选槽**授予（新 fence、新 deadline），记入 `granted`（授予顺序）。
3. 直到没有空闲或没有等待者。
4. `acquire`/`renew`/`release`/`cancelWait` 都不会执行步骤 1 的过期（`release` 只晋升，不过期）。

查询：

- `heldSlots(): number[]` 当前仍登记为持有的槽（可含已过期未 drive），升序。
- `holderOf(slot)` / `fenceOf(slot)` / `deadlineOf(slot)`：非法 slot 抛错；空闲 → `null`；过期未 drive 仍返回原值。
- `waitingTickets(): number[]` / `waitingHolders(): string[]` FIFO。
- `preferredSlot(holder)` / `clearAffinity(holder)` 见上。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
