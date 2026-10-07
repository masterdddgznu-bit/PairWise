## 简述

实现进程内按印窗登记的障纸架：版式只在印窗内可被压印；压印还受障掩与墨额约束。容量、障掩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`Frisket`，以及错误类 `FrisketError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidImpressionsError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new Frisket({
  clock,
  maxFormes?: number,     // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

版式字段：`id`、`payload`、`pressAt`、`liftAt`、`impressions`（正整数，表示仍可压印的余量；每次成功压印消耗 1 次余量）。

印窗相对当前 `now` 可能完全在过去或未来。窗外的版式仍登记、仍占容量：尚未进入窗的不可压印；已经越过窗尾的称为耗尽版，占用容量直到被冲刷或压印至余量为 0。窗边界（`now` 恰好落在 `pressAt` / `liftAt` 上是否可压印）以测试为准。

`plate(id, payload, pressAt, liftAt, impressions?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `pressAt` / `liftAt` 须为有限整数且 `>= 0`，且 `liftAt > pressAt`，否则 `InvalidSpanError`。
- `impressions` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidImpressionsError`。
- 新 id 且登记数已达 `maxFormes` → `CapacityError`。
- 已存在：覆盖 `payload` / `pressAt` / `liftAt` / `impressions`（余量重置为新值），返回 `updated`；不改变首次登记序。障掩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新版式的默认障掩状态以测试为准（不要假设与其它题相同）。

`shift(id, pressAt, liftAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/impressions/首次序不变，`true`。障掩是否随 shift 变化以测试为准。掩住时也可 shift。

`scrap(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除掩记录），`true`；不存在 `false`。压印不退还已消耗的墨额。

`mask(id): boolean` / `unmask(id): boolean` / `isMasked(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isMasked` 对不存在同样抛 `UnknownIdError`）。
- `mask`：已掩仍 `true`（幂等）；障掩不释放容量，版式仍计入 `size` / `ids`。
- `unmask`：已松仍 `true`（幂等）。掩住的版式不可 peek / impress，也不会被 run 冲刷。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用墨额，返回授予后余额。

`credit(): number` — 当前可用墨额（非负整数）。

压印候选：当前处于印窗内、障掩已松、且余量 `>= 1`。peek / impress / liveIds 都不清除耗尽版。冲刷耗尽版不消耗墨额。每次成功压印消耗的墨额如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; pressAt; liftAt; impressions } | null`

- 在压印候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`impressions` 为当前余量）。

`impress(): { id; payload; pressAt; liftAt; impressions } | null`

- 在压印候选中按与 peek 相同次序考虑压印。额度不足时的取舍以测试为准。
- 成功则按规则扣除墨额、余量减 1；返回的 `impressions` 为减后余量。减后为 0 则移除该版。
- 无可压印项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部压印候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`run(): { impressed: Array<{ id; payload; pressAt; liftAt; impressions }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽版。
- 冲刷快照下已成耗尽版且障掩已松、也未被本次压印移除的版式；`spent` 为这些 id，按首次登记序。掩住即使已成耗尽版也保留。冲刷不扣额度。
- 按 `impress` 规则反复压印快照下障掩已松、仍处于印窗内的版式，直到额度用尽或没有候选；`impressed` 为各次压印返回值的顺序。冲刷与压印谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽版、掩住），按首次登记序。
- `size(): number` 与 `ids().length` 相同；掩住与耗尽版均占容量。
- `spanOf(id)` 返回 `{ pressAt, liftAt }` 或 `null`；`impressionsOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、障掩门禁、墨额账本），内部文件名自定；正确性以不变量与测试为准。压印候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
