## 简述

实现进程内按成熟窗登记的腌制仓：批次只在成熟窗内可被捞出；捞出还受封盖门禁与盐额度约束。容量、封盖与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`BrineVat`，以及错误类 `BrineVatError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSoakError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new BrineVat({
  clock,
  maxLots?: number,        // 默认 12，整数 >= 1
  initialSalt?: number,    // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

批次字段：`id`、`payload`、`readyAt`、`spoilAt`、`cost`（正整数，捞出时消耗盐）。

成熟：`readyAt <= now` 且 `now < spoilAt`（闭开区间）。未成熟或已过 spoil 的批次仍登记、仍占容量，只是不可捞出。已过 spoil 的批次称为腐坏，占用容量直到被冲刷或倒掉。

`dip(id, payload, readyAt, spoilAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `readyAt` / `spoilAt` 须为有限整数且 `>= 0`，且 `spoilAt > readyAt`，否则 `InvalidSoakError`。允许窗口相对当前 `now` 完全在过去或未来。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxLots` → `CapacityError`。
- 已存在：覆盖 `payload` / `readyAt` / `spoilAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变封盖状态。
- 新 id：`accepted`，追加到首次登记序尾；新批次默认封盖（不可捞出、不可被 drive 当作腐坏冲刷）。

`recure(id, readyAt, spoilAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/封盖/首次序不变，`true`。封盖中也可 recure。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除封盖），`true`；不存在 `false`。倒掉不退还已消耗的盐。

`seal(id): boolean` / `unseal(id): boolean` / `isSealed(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isSealed` 对不存在同样抛 `UnknownIdError`）。
- `seal`：已封盖仍 `true`（幂等）；封盖不释放容量，批次仍计入 `size` / `ids`。
- `unseal`：未封盖仍 `true`（幂等）。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用盐，返回授予后余额。

`salt(): number` — 当前可用盐（非负整数）。

取出候选：当前成熟且未封盖。peek / pop / ripeIds 都不自动清除已腐坏的批次。冲刷腐坏不消耗盐。

`peek(): { id; payload; readyAt; spoilAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣盐。无候选 → `null`。
- peek 忽略额度是否足够（盐不足仍可 peek 到该项）。

`pop(): { id; payload; readyAt; spoilAt; cost } | null`

- 在取出候选中按与 peek 相同次序扫描，捞出第一个 `cost <= salt` 的批次并移除，扣减等额盐。
- 若队头额度不足，跳过它继续找后续可负担项；被跳过的项仍登记、封盖状态不变。
- 无可负担候选 → `null`（不扣盐）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣盐）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; readyAt; spoilAt; cost }>; scrubbed: string[] }`

- 以调用开始时的 `now` 为快照判定成熟与腐坏。
- 反复按 `pop` 规则捞出快照下可负担、未封盖、仍成熟的批次，直到无法再取；`drawn` 为捞出顺序。
- 然后清除快照下已腐坏且未封盖、也未被本次捞出的批次；`scrubbed` 为这些 id，按首次登记序。封盖中即使已腐坏也保留。冲刷不扣盐。

查询：

- `ids(): string[]` 全部仍登记 id（含未成熟、已腐坏、封盖），按首次登记序。
- `size(): number` 与 `ids().length` 相同；封盖与腐坏均占容量。
- `soakOf(id)` 返回 `{ readyAt, spoilAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、封盖门禁、盐账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
