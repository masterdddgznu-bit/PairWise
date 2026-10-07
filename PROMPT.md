## 简述

实现进程内按张紧窗登记的死眼滑车舱：眼环只在张紧窗内可被绞紧；绞紧还受楔闩与股索额度约束。容量、楔闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`DeadEye`，以及错误类 `DeadEyeError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidStrandsError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new DeadEye({
  clock,
  maxEyes?: number,       // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

眼环字段：`id`、`payload`、`makeAt`、`castAt`、`strands`（正整数，表示仍可绞紧的余量；每次成功绞紧消耗 1 次余量）。

张紧窗相对当前 `now` 可能完全在过去或未来。窗外的眼环仍登记、仍占容量：尚未进入窗的不可绞紧；已经越过窗尾的称为耗尽眼，占用容量直到被冲刷或绞紧至余量为 0。窗边界（`now` 恰好落在 `makeAt` / `castAt` 上是否可绞紧）以测试为准。

`seat(id, payload, makeAt, castAt, strands?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `makeAt` / `castAt` 须为有限整数且 `>= 0`，且 `castAt > makeAt`，否则 `InvalidSpanError`。
- `strands` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidStrandsError`。
- 新 id 且登记数已达 `maxEyes` → `CapacityError`。
- 已存在：覆盖 `payload` / `makeAt` / `castAt` / `strands`（余量重置为新值），返回 `updated`；不改变首次登记序。楔闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新眼环的默认楔闩状态以测试为准（不要假设与其它题相同）。

`retie(id, makeAt, castAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/strands/首次序不变，`true`。楔闩是否随 retie 变化以测试为准。已楔时也可 retie。

`scrap(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除楔闩记录），`true`；不存在 `false`。绞紧不退还已消耗的股索额度。

`wedge(id): boolean` / `unwedge(id): boolean` / `isWedged(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isWedged` 对不存在同样抛 `UnknownIdError`）。
- `wedge`：已楔仍 `true`（幂等）；楔闩不释放容量，眼环仍计入 `size` / `ids`。
- `unwedge`：已松仍 `true`（幂等）。楔闩如何影响 peek / heave / 冲刷，以测试为准（不要假设「松才可作业」或「楔才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用股索额度，返回授予后余额。

`credit(): number` — 当前可用股索额度（非负整数）。

绞紧候选：当前处于张紧窗内、满足楔闩条件、且余量 `>= 1`。peek / heave / liveIds 都不清除耗尽眼。冲刷耗尽眼不消耗股索额度。每次成功绞紧消耗的额度如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; makeAt; castAt; strands } | null`

- 在绞紧候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`strands` 为当前余量）。

`heave(): { id; payload; makeAt; castAt; strands } | null`

- 在绞紧候选中按与 peek 相同次序考虑绞紧。额度不足时的取舍以测试为准。
- 成功则按规则扣除股索额度、余量减 1；返回的 `strands` 为减后余量。减后为 0 则移除该眼。
- 无可绞紧项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部绞紧候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { heaved: Array<{ id; payload; makeAt; castAt; strands }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽眼。
- 冲刷快照下已成耗尽眼且满足楔闩条件、也未被本次绞紧移除的眼环；`spent` 为这些 id，按首次登记序。不满足楔闩条件即使已成耗尽眼也保留。冲刷不扣额度。
- 按 `heave` 规则反复绞紧快照下满足楔闩条件、仍处于张紧窗内的眼环，直到额度用尽或没有候选；`heaved` 为各次绞紧返回值的顺序。冲刷与绞紧谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽眼、未满足楔闩条件者），按首次登记序。
- `size(): number` 与 `ids().length` 相同；未楔与耗尽眼均占容量。
- `spanOf(id)` 返回 `{ makeAt, castAt }` 或 `null`；`strandsOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、楔闩门禁、股索账本），内部文件名自定；正确性以不变量与测试为准。绞紧候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
