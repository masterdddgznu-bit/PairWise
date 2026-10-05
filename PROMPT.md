## 简述

实现进程内加权滑动时间窗：登记带基础权重与优先级的事件；支持临时加权重（boost）及其到期；窗口有效权重超过上限时按规则甩载最低优先级条目。查询不做副作用。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`WeightWin`，以及错误类 `WeightWinError` 和至少 `InvalidConfigError` / `InvalidIdError` / `InvalidWeightError` / `InvalidPriorityError` / `InvalidBoostError` / `DuplicateIdError` / `UnknownIdError` / `CapacityError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new WeightWin({
  clock,
  windowMs,
  maxSum,
})
```

- `windowMs`、`maxSum` 均为整数 `>= 1`；非法配置抛 `InvalidConfigError`。
- 窗口内判定：`now - ts < windowMs`（相等视为已滑出）。
- **有效权重** = 基础权重 + 该 id 上所有尚未到期的 boost 增量之和。
- 宜拆成多模块协作（窗口登记、临时加权账本、甩载策略），具体文件划分自定。

`add(id, weight, priority): { status: 'accepted'; shed: string[] }`

- `id` 非空，否则 `InvalidIdError`。
- `weight` 整数 `>= 1`，否则 `InvalidWeightError`。
- `priority` 整数 `>= 0`（数值越小优先级越低、越先被甩），否则 `InvalidPriorityError`。
- 先执行与 `drive` 相同的「过期清理」步骤（见下），但不做甩载循环。
- 若 id 仍存在 → `DuplicateIdError`。
- 以 `ts = now` 登记该事件（追加到首次 add 序尾）。
- 若登记后窗口内有效权重和 `> maxSum`：按甩载规则反复移除受害者，直到 `<= maxSum`；被移除 id 记入 `shed`（移除顺序）。
- 若新登记自身有效权重已 `> maxSum`（无法靠甩掉其它条目解决）→ 撤销本次登记并抛 `CapacityError`（`shed` 不产生）。
- 甩载规则（窗口内条目）：优先甩 **priority 最小**；并列则甩 **首次 add 更早** 者；**可以甩掉刚加入的 id**（若它是当前最低优先级受害者）。

`boost(id, amount, ttlMs): { boostId: number }`

- `id` 非法 → `InvalidIdError`；不存在（含已甩/已清）→ `UnknownIdError`。
- `amount` 整数 `>= 1`，`ttlMs` 整数 `>= 1`，否则 `InvalidBoostError`。
- 先做与 `add` 相同的过期清理（不做甩载）。
- 登记一条临时增量，`boostId` 从 1 起全局递增；`expiresAt = now + ttlMs`。
- 若因此窗口内有效和 `> maxSum`：按同上甩载规则甩到 `<= maxSum`（可能甩掉被 boost 的 id，其 boost 一并消失）。
- 若 boost 后该 id 仍在且有效和仍无法压到 `maxSum`（极端：单 id 有效权重 `> maxSum`）→ 撤销本次 boost 并 `CapacityError`。
- 返回 `{ boostId }`（若中途甩掉了别的 id，不在返回值里列出；可用随后查询观察）。

`cancel(id): boolean`

- 非法 id → `InvalidIdError`。
- 先过期清理（不做甩载）。
- 若 id 仍在则移除（含其全部 boost），`true`；否则 `false`。

`drive(): { purged: string[]; expiredBoosts: number[]; shed: string[] }`

1. **过期清理**：移除所有已滑出窗口的登记（及其 boost），`purged` 为这些 id（首次 add 序）；使所有 `expiresAt <= now` 的 boost 失效，`expiredBoosts` 为失效 `boostId` 升序。
2. **甩载**：若窗口内有效和仍 `> maxSum`（例如多个 boost 叠加后），按甩载规则移除直到 `<= maxSum`，`shed` 为被甩 id（顺序）。
3. 查询 API **不得**执行上述任一步。

查询（无副作用；已滑出未 purge 的登记仍占 id，但其权重 **不计入** `sum()`）：

- `sum(): number` 仅窗口内有效权重和。
- `size(): number` 仍登记总数（可含已滑出未 purge）。
- `ids(): string[]` 仍登记全部 id，首次 add 序。
- `inWindowIds(): string[]` 仅窗口内 id，首次 add 序。
- `weightOf(id): number | null` 基础权重；不存在 → `null`；非法 id 抛错。
- `effectiveWeightOf(id): number | null` 基础 + 账本上尚未被 `drive`/变更操作清掉的 boost；不存在 → `null`；**不**因查询清掉已到点的 boost。
- `priorityOf(id): number | null` / `addedAt(id): number | null`。
- `activeBoostIds(id): number[]` 该 id 上仍在账本中的 boostId 升序；id 不存在 → `[]`（非法 id 抛错）。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
