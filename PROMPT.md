## 简述

实现进程内按攀爬窗登记的横索舱：横索只在攀爬窗内可被攀爬；攀爬还受扣闩与攀爬额度约束。容量、扣闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`Ratline`，以及错误类 `RatlineError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidRungsError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new Ratline({
  clock,
  maxLines?: number,      // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

横索字段：`id`、`payload`、`stepAt`、`castAt`、`rungs`（正整数，表示仍可攀爬的余量；每次成功攀爬消耗 1 档余量）。

攀爬窗相对当前 `now` 可能完全在过去或未来。窗外的横索仍登记、仍占容量：尚未进入窗的不可攀爬；已经越过窗尾的称为耗尽横索，占用容量直到被冲刷或攀爬至余量为 0。窗边界（`now` 恰好落在 `stepAt` / `castAt` 上是否可攀爬）以测试为准。

`hitch(id, payload, stepAt, castAt, rungs?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `stepAt` / `castAt` 须为有限整数且 `>= 0`，且 `castAt > stepAt`，否则 `InvalidSpanError`。
- `rungs` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidRungsError`。
- 新 id 且登记数已达 `maxLines` → `CapacityError`。
- 已存在：覆盖 `payload` / `stepAt` / `castAt` / `rungs`（余量重置为新值），返回 `updated`；不改变首次登记序。扣闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新横索的默认扣闩状态以测试为准（不要假设与其它题相同）。

`ease(id, stepAt, castAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/rungs/首次序不变，`true`。扣闩是否随 ease 变化以测试为准。已扣时也可 ease。

`castOff(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除扣记录），`true`；不存在 `false`。攀爬不退还已消耗的攀爬额度。

`seize(id): boolean` / `free(id): boolean` / `isSeized(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isSeized` 对不存在同样抛 `UnknownIdError`）。
- `seize`：已扣仍 `true`（幂等）；扣闩不释放容量，横索仍计入 `size` / `ids`。
- `free`：已松仍 `true`（幂等）。扣闩如何影响 peek / climb / 冲刷，以测试为准（不要假设「松才可作业」或「扣才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用攀爬额度，返回授予后余额。

`credit(): number` — 当前可用攀爬额度（非负整数）。

攀爬候选：当前处于攀爬窗内、满足扣闩门条件、且余量 `>= 1`。peek / climb / liveIds 都不清除耗尽横索。冲刷耗尽横索不消耗攀爬额度。每次成功攀爬消耗的额度如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; stepAt; castAt; rungs } | null`

- 在攀爬候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`rungs` 为当前余量）。

`climb(): { id; payload; stepAt; castAt; rungs } | null`

- 在攀爬候选中按与 peek 相同次序考虑攀爬。额度不足时的取舍以测试为准。
- 成功则按规则扣除攀爬额度、余量减 1；返回的 `rungs` 为减后余量。减后为 0 则移除该横索。
- 无可攀爬项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部攀爬候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { climbed: Array<{ id; payload; stepAt; castAt; rungs }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽横索。
- 冲刷快照下已成耗尽横索且满足扣闩门条件、也未被本次攀爬移除的横索；`spent` 为这些 id，按首次登记序。不满足扣闩门条件即使已成耗尽横索也保留。冲刷不扣额度。
- 按 `climb` 规则反复攀爬快照下满足扣闩门条件、仍处于攀爬窗内的横索，直到额度用尽或没有候选；`climbed` 为各次攀爬返回值的顺序。冲刷与攀爬谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽横索、未满足扣闩门条件者），按首次登记序。
- `size(): number` 与 `ids().length` 相同；扣住与耗尽横索均占容量。
- `spanOf(id)` 返回 `{ stepAt, castAt }` 或 `null`；`rungsOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、扣闩门禁、攀爬账本），内部文件名自定；正确性以不变量与测试为准。攀爬候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
