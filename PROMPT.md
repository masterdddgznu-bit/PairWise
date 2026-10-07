## 简述

实现进程内按升帆窗登记的帕瑞尔珠舱：珠串只在升帆窗内可被绞升；绞升还受封印闩与升力额度约束。容量、封印闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`ParrelBead`，以及错误类 `ParrelBeadError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidBeadsError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new ParrelBead({
  clock,
  maxBeads?: number,      // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

珠串字段：`id`、`payload`、`rigAt`、`dropAt`、`beads`（正整数，表示仍可绞升的余量；每次成功绞升消耗 1 颗余量）。

升帆窗相对当前 `now` 可能完全在过去或未来。窗外的珠串仍登记、仍占容量：尚未进入窗的不可绞升；已经越过窗尾的称为耗尽珠串，占用容量直到被冲刷或绞升至余量为 0。窗边界（`now` 恰好落在 `rigAt` / `dropAt` 上是否可绞升）以测试为准。

`seat(id, payload, rigAt, dropAt, beads?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `rigAt` / `dropAt` 须为有限整数且 `>= 0`，且 `dropAt > rigAt`，否则 `InvalidSpanError`。
- `beads` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidBeadsError`。
- 新 id 且登记数已达 `maxBeads` → `CapacityError`。
- 已存在：覆盖 `payload` / `rigAt` / `dropAt` / `beads`（余量重置为新值），返回 `updated`；不改变首次登记序。封印闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新珠串的默认封印状态以测试为准（不要假设与其它题相同）。

`nudge(id, rigAt, dropAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/beads/首次序不变，`true`。封印闩是否随 nudge 变化以测试为准。已封时也可 nudge。

`castOff(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除封印记录），`true`；不存在 `false`。绞升不退还已消耗的升力额度。

`seal(id): boolean` / `unseal(id): boolean` / `isSealed(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isSealed` 对不存在同样抛 `UnknownIdError`）。
- `seal`：已封仍 `true`（幂等）；封印不释放容量，珠串仍计入 `size` / `ids`。
- `unseal`：已松仍 `true`（幂等）。封印如何影响 peek / hoist / 冲刷，以测试为准（不要假设「松才可作业」或「紧才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用升力额度，返回授予后余额。

`credit(): number` — 当前可用升力额度（非负整数）。

绞升候选：当前处于升帆窗内、满足封印闩门条件、且余量 `>= 1`。peek / hoist / liveIds 都不清除耗尽珠串。冲刷耗尽珠串不消耗升力额度。每次成功绞升消耗的额度如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; rigAt; dropAt; beads } | null`

- 在绞升候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`beads` 为当前余量）。

`hoist(): { id; payload; rigAt; dropAt; beads } | null`

- 在绞升候选中按与 peek 相同次序考虑绞升。额度不足时的取舍以测试为准。
- 成功则按规则扣除升力额度、余量减 1；返回的 `beads` 为减后余量。减后为 0 则移除该珠串。
- 无可绞升项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部绞升候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { hoisted: Array<{ id; payload; rigAt; dropAt; beads }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽珠串。
- 冲刷快照下已成耗尽珠串且满足封印闩门条件、也未被本次绞升移除的珠串；`spent` 为这些 id，按首次登记序。不满足封印闩门条件即使已成耗尽珠串也保留。冲刷不扣额度。
- 按 `hoist` 规则反复绞升快照下满足封印闩门条件、仍处于升帆窗内的珠串，直到额度用尽或没有候选；`hoisted` 为各次绞升返回值的顺序。冲刷与绞升谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽珠串、未满足封印闩门条件者），按首次登记序。
- `size(): number` 与 `ids().length` 相同；封印与耗尽珠串均占容量。
- `spanOf(id)` 返回 `{ rigAt, dropAt }` 或 `null`；`beadsOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、封印门禁、升力账本），内部文件名自定；正确性以不变量与测试为准。绞升候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
