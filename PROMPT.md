## 简述

实现进程内按起锚窗登记的猫头横杆舱：锚钩只在起锚窗内可被钓起；钓起还受掣爪闩与信使索额度约束。容量、掣爪闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`CatHead`，以及错误类 `CatHeadError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidBitesError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new CatHead({
  clock,
  maxHooks?: number,      // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

锚钩字段：`id`、`payload`、`hitchAt`、`castAt`、`bites`（正整数，表示仍可钓起的余量；每次成功钓起消耗 1 次余量）。

起锚窗相对当前 `now` 可能完全在过去或未来。窗外的锚钩仍登记、仍占容量：尚未进入窗的不可钓起；已经越过窗尾的称为耗尽钩，占用容量直到被冲刷或钓起至余量为 0。窗边界（`now` 恰好落在 `hitchAt` / `castAt` 上是否可钓起）以测试为准。

`seat(id, payload, hitchAt, castAt, bites?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `hitchAt` / `castAt` 须为有限整数且 `>= 0`，且 `castAt > hitchAt`，否则 `InvalidSpanError`。
- `bites` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidBitesError`。
- 新 id 且登记数已达 `maxHooks` → `CapacityError`。
- 已存在：覆盖 `payload` / `hitchAt` / `castAt` / `bites`（余量重置为新值），返回 `updated`；不改变首次登记序。掣爪闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新锚钩的默认掣爪闩状态以测试为准（不要假设与其它题相同）。

`retune(id, hitchAt, castAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/bites/首次序不变，`true`。掣爪闩是否随 retune 变化以测试为准。已掣时也可 retune。

`scrap(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除掣爪闩记录），`true`；不存在 `false`。钓起不退还已消耗的信使索额度。

`pawl(id): boolean` / `unpawl(id): boolean` / `isPawled(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isPawled` 对不存在同样抛 `UnknownIdError`）。
- `pawl`：已掣仍 `true`（幂等）；掣爪闩不释放容量，锚钩仍计入 `size` / `ids`。
- `unpawl`：已松仍 `true`（幂等）。掣爪闩如何影响 peek / fish / 冲刷，以测试为准（不要假设「松才可作业」或「掣才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用信使索额度，返回授予后余额。

`credit(): number` — 当前可用信使索额度（非负整数）。

钓起候选：当前处于起锚窗内、满足掣爪闩条件、且余量 `>= 1`。peek / fish / liveIds 都不清除耗尽钩。冲刷耗尽钩不消耗信使索额度。每次成功钓起消耗的额度如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; hitchAt; castAt; bites } | null`

- 在钓起候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`bites` 为当前余量）。

`fish(): { id; payload; hitchAt; castAt; bites } | null`

- 在钓起候选中按与 peek 相同次序考虑钓起。额度不足时的取舍以测试为准。
- 成功则按规则扣除信使索额度、余量减 1；返回的 `bites` 为减后余量。减后为 0 则移除该钩。
- 无可钓起项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部钓起候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { fished: Array<{ id; payload; hitchAt; castAt; bites }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽钩。
- 冲刷快照下已成耗尽钩且满足掣爪闩条件、也未被本次钓起移除的锚钩；`spent` 为这些 id，按首次登记序。不满足掣爪闩条件即使已成耗尽钩也保留。冲刷不扣额度。
- 按 `fish` 规则反复钓起快照下满足掣爪闩条件、仍处于起锚窗内的锚钩，直到额度用尽或没有候选；`fished` 为各次钓起返回值的顺序。冲刷与钓起谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽钩、未满足掣爪闩条件者），按首次登记序。
- `size(): number` 与 `ids().length` 相同；未掣与耗尽钩均占容量。
- `spanOf(id)` 返回 `{ hitchAt, castAt }` 或 `null`；`bitesOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、掣爪闩门禁、信使索账本），内部文件名自定；正确性以不变量与测试为准。钓起候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
