## 简述

实现进程内按系缆窗登记的羊角桩舱：缆绳只在系缆窗内可被绞收；绞收还受活结闩与绞次额度约束。容量、活结闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`Kevel`，以及错误类 `KevelError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidTurnsError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new Kevel({
  clock,
  maxLines?: number,      // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

缆绳字段：`id`、`payload`、`makeAt`、`castAt`、`turns`（正整数，表示仍可绞收的余量；每次成功绞收消耗 1 次余量）。

系缆窗相对当前 `now` 可能完全在过去或未来。窗外的缆绳仍登记、仍占容量：尚未进入窗的不可绞收；已经越过窗尾的称为耗尽缆绳，占用容量直到被冲刷或绞收至余量为 0。窗边界（`now` 恰好落在 `makeAt` / `castAt` 上是否可绞收）以测试为准。

`belay(id, payload, makeAt, castAt, turns?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `makeAt` / `castAt` 须为有限整数且 `>= 0`，且 `castAt > makeAt`，否则 `InvalidSpanError`。
- `turns` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidTurnsError`。
- 新 id 且登记数已达 `maxLines` → `CapacityError`。
- 已存在：覆盖 `payload` / `makeAt` / `castAt` / `turns`（余量重置为新值），返回 `updated`；不改变首次登记序。活结闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新缆绳的默认活结状态以测试为准（不要假设与其它题相同）。

`shift(id, makeAt, castAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/turns/首次序不变，`true`。活结闩是否随 shift 变化以测试为准。已紧时也可 shift。

`castOff(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除活结记录），`true`；不存在 `false`。绞收不退还已消耗的绞次额度。

`fast(id): boolean` / `slack(id): boolean` / `isFast(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isFast` 对不存在同样抛 `UnknownIdError`）。
- `fast`：已紧仍 `true`（幂等）；活结不释放容量，缆绳仍计入 `size` / `ids`。
- `slack`：已松仍 `true`（幂等）。活结如何影响 peek / haul / 冲刷，以测试为准（不要假设「松才可作业」或「紧才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用绞次额度，返回授予后余额。

`credit(): number` — 当前可用绞次额度（非负整数）。

绞收候选：当前处于系缆窗内、满足活结闩门条件、且余量 `>= 1`。peek / haul / liveIds 都不清除耗尽缆绳。冲刷耗尽缆绳不消耗绞次额度。每次成功绞收消耗的额度如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; makeAt; castAt; turns } | null`

- 在绞收候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`turns` 为当前余量）。

`haul(): { id; payload; makeAt; castAt; turns } | null`

- 在绞收候选中按与 peek 相同次序考虑绞收。额度不足时的取舍以测试为准。
- 成功则按规则扣除绞次额度、余量减 1；返回的 `turns` 为减后余量。减后为 0 则移除该缆绳。
- 无可绞收项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部绞收候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { hauled: Array<{ id; payload; makeAt; castAt; turns }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽缆绳。
- 冲刷快照下已成耗尽缆绳且满足活结闩门条件、也未被本次绞收移除的缆绳；`spent` 为这些 id，按首次登记序。不满足活结闩门条件即使已成耗尽缆绳也保留。冲刷不扣额度。
- 按 `haul` 规则反复绞收快照下满足活结闩门条件、仍处于系缆窗内的缆绳，直到额度用尽或没有候选；`hauled` 为各次绞收返回值的顺序。冲刷与绞收谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽缆绳、未满足活结闩门条件者），按首次登记序。
- `size(): number` 与 `ids().length` 相同；未松与耗尽缆绳均占容量。
- `spanOf(id)` 返回 `{ makeAt, castAt }` 或 `null`；`turnsOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、活结门禁、绞次账本），内部文件名自定；正确性以不变量与测试为准。绞收候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
