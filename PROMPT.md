## 简述

实现进程内按绝对截止时间调度的工作堆：登记项在 `dueAt <= now` 时就绪；取出还受预算信用与冻结门禁约束。容量、冻结与预算三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`DueHeap`，以及错误类 `DueHeapError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidDueError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new DueHeap({
  clock,
  maxItems?: number,       // 默认 16，整数 >= 1
  initialCredit?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

工作项字段：`id`、`payload`、`dueAt`、`cost`（正整数，表示取出时消耗的信用）。

`schedule(id, payload, dueAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `dueAt` 有限整数且 `>= 0`，否则 `InvalidDueError`（允许 `dueAt < now`，表示立即就绪）。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxItems` → `CapacityError`。
- 已存在：覆盖 `payload` / `dueAt` / `cost`，返回 `updated`；**不改变**首次登记序，也不改变冻结状态。
- 新 id：`accepted`，追加到首次登记序尾；新项默认未冻结。

`reschedule(id, dueAt): boolean` — 非法参抛错；不存在 `false`；存在只改 `dueAt`，payload/cost/冻结/首次序不变，`true`。**冻结中也可 reschedule。**

`cancel(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除冻结），`true`；不存在 `false`。取消不退还已消耗的信用。

`freeze(id): boolean` / `unfreeze(id): boolean` / `isFrozen(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isFrozen` 对不存在同样抛 `UnknownIdError`）。
- `freeze`：已冻结仍 `true`（幂等）；冻结**不释放容量**，项仍计入 `size`/`ids`。
- `unfreeze`：未冻结仍 `true`（幂等）。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用信用，返回授予后余额。

`credit(): number` — 当前可用信用（非负整数）。

就绪且可展示（peek 候选）：`dueAt <= now` **且未冻结**。

`peek(): { id; payload; dueAt; cost } | null`

- 在 peek 候选中取 `dueAt` 最小者；并列取首次登记序更早者。
- **不移除、不扣信用**。无候选 → `null`。
- peek **忽略**预算是否足够（信用不足仍可 peek 到该项）。

`pop(): { id; payload; dueAt; cost } | null`

- 在 peek 候选中，按与 peek 相同次序扫描，取出**第一个** `cost <= credit` 的项并移除，扣减等额信用。
- 若队头（peek 意义下）信用不足，**跳过**它继续找后续可负担项；被跳过的项仍登记、仍冻结状态不变。
- 无可负担就绪未冻结项 → `null`（不扣信用）。

`readyIds(): string[]` — 当前所有 peek 候选 id，排序与连续 peek 次序一致（不移除、不扣信用）。含信用不足者。

`drive(): { drained: Array<{ id; payload; dueAt; cost }> }`

- 以调用开始时的 `now` 为截止快照：仅考虑开始时已 `dueAt <= snapshotNow` 的项（drive 过程中即使外部改钟也不在本题发生；实现仍应以快照 now 判定 due）。
- 反复按 `pop` 规则取出可负担、未冻结、且在快照下已到期的项，直到无法再取。
- 返回 `drained` 为取出顺序；每取一项扣信用。

查询：

- `ids(): string[]` 全部仍登记 id（含未到期与冻结），按首次登记序。
- `size(): number` 与 `ids().length` 相同；**冻结与未到期均占容量**。
- `dueOf(id)` / `costOf(id)`：不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记序与 due、预算账本、冻结门禁），但内部文件名自定；正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
