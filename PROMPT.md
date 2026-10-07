## 简述

实现进程内按过链窗登记的锚链筒舱：锚链只在过链窗内可被绞进；绞进还受键闩与链节额度约束。容量、键闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`HawsePipe`，以及错误类 `HawsePipeError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidLinksError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new HawsePipe({
  clock,
  maxChains?: number,     // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

锚链字段：`id`、`payload`、`makeAt`、`slipAt`、`links`（正整数，表示仍可绞进的余量；每次成功绞进消耗 1 次余量）。

过链窗相对当前 `now` 可能完全在过去或未来。窗外的锚链仍登记、仍占容量：尚未进入窗的不可绞进；已经越过窗尾的称为耗尽链，占用容量直到被冲刷或绞进至余量为 0。窗边界（`now` 恰好落在 `makeAt` / `slipAt` 上是否可绞进）以测试为准。

`seat(id, payload, makeAt, slipAt, links?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `makeAt` / `slipAt` 须为有限整数且 `>= 0`，且 `slipAt > makeAt`，否则 `InvalidSpanError`。
- `links` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidLinksError`。
- 新 id 且登记数已达 `maxChains` → `CapacityError`。
- 已存在：覆盖 `payload` / `makeAt` / `slipAt` / `links`（余量重置为新值），返回 `updated`；不改变首次登记序。键闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新锚链的默认键闩状态以测试为准（不要假设与其它题相同）。

`retune(id, makeAt, slipAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/links/首次序不变，`true`。键闩是否随 retune 变化以测试为准。已键时也可 retune。

`castOff(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除键闩记录），`true`；不存在 `false`。绞进不退还已消耗的链节额度。

`key(id): boolean` / `unkey(id): boolean` / `isKeyed(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isKeyed` 对不存在同样抛 `UnknownIdError`）。
- `key`：已键仍 `true`（幂等）；键闩不释放容量，锚链仍计入 `size` / `ids`。
- `unkey`：已松仍 `true`（幂等）。键闩如何影响 peek / haul / 冲刷，以测试为准（不要假设「松才可作业」或「键才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用链节额度，返回授予后余额。

`credit(): number` — 当前可用链节额度（非负整数）。

绞进候选：当前处于过链窗内、满足键闩条件、且余量 `>= 1`。peek / haul / liveIds 都不清除耗尽链。冲刷耗尽链不消耗链节额度。每次成功绞进消耗的额度如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; makeAt; slipAt; links } | null`

- 在绞进候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`links` 为当前余量）。

`haul(): { id; payload; makeAt; slipAt; links } | null`

- 在绞进候选中按与 peek 相同次序考虑绞进。额度不足时的取舍以测试为准。
- 成功则按规则扣除链节额度、余量减 1；返回的 `links` 为减后余量。减后为 0 则移除该链。
- 无可绞进项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部绞进候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { hauled: Array<{ id; payload; makeAt; slipAt; links }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽链。
- 冲刷快照下已成耗尽链且满足键闩条件、也未被本次绞进移除的锚链；`spent` 为这些 id，按首次登记序。不满足键闩条件即使已成耗尽链也保留。冲刷不扣额度。
- 按 `haul` 规则反复绞进快照下满足键闩条件、仍处于过链窗内的锚链，直到额度用尽或没有候选；`hauled` 为各次绞进返回值的顺序。冲刷与绞进谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽链、未满足键闩条件者），按首次登记序。
- `size(): number` 与 `ids().length` 相同；未键与耗尽链均占容量。
- `spanOf(id)` 返回 `{ makeAt, slipAt }` 或 `null`；`linksOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、键闩门禁、链节账本），内部文件名自定；正确性以不变量与测试为准。绞进候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
