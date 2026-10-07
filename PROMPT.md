## 简述

实现进程内按外飘窗登记的舷侧肋骨舱：肋骨只在外飘窗内可被收绞；收绞还受撑闩与橡木额度约束。容量、撑闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`Tumblehome`，以及错误类 `TumblehomeError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidRibsError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new Tumblehome({
  clock,
  maxRibs?: number,       // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

肋骨字段：`id`、`payload`、`heelAt`、`flareAt`、`ribs`（正整数，表示仍可收绞的余量；每次成功收绞消耗 1 档余量）。

外飘窗相对当前 `now` 可能完全在过去或未来。窗外的肋骨仍登记、仍占容量：尚未进入窗的不可收绞；已经越过窗尾的称为耗尽肋骨，占用容量直到被冲刷或收绞至余量为 0。窗边界（`now` 恰好落在 `heelAt` / `flareAt` 上是否可收绞）以测试为准。

`plant(id, payload, heelAt, flareAt, ribs?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `heelAt` / `flareAt` 须为有限整数且 `>= 0`，且 `flareAt > heelAt`，否则 `InvalidSpanError`。
- `ribs` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidRibsError`。
- 新 id 且登记数已达 `maxRibs` → `CapacityError`。
- 已存在：覆盖 `payload` / `heelAt` / `flareAt` / `ribs`（余量重置为新值），返回 `updated`；不改变首次登记序。撑闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新肋骨的默认撑闩状态以测试为准（不要假设与其它题相同）。

`nudge(id, heelAt, flareAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/ribs/首次序不变，`true`。撑闩是否随 nudge 变化以测试为准。已撑时也可 nudge。

`scrap(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除撑闩记录），`true`；不存在 `false`。收绞不退还已消耗的橡木额度。

`brace(id): boolean` / `unbrace(id): boolean` / `isBraced(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isBraced` 对不存在同样抛 `UnknownIdError`）。
- `brace`：已撑仍 `true`（幂等）；撑闩不释放容量，肋骨仍计入 `size` / `ids`。
- `unbrace`：已松仍 `true`（幂等）。撑闩如何影响 peek / haul / 冲刷，以测试为准（不要假设「松才可作业」或「撑才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用橡木额度，返回授予后余额。

`credit(): number` — 当前可用橡木额度（非负整数）。

收绞候选：当前处于外飘窗内、满足撑闩门条件、且余量 `>= 1`。peek / haul / liveIds 都不清除耗尽肋骨。冲刷耗尽肋骨不消耗橡木额度。每次成功收绞消耗的额度如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; heelAt; flareAt; ribs } | null`

- 在收绞候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`ribs` 为当前余量）。

`haul(): { id; payload; heelAt; flareAt; ribs } | null`

- 在收绞候选中按与 peek 相同次序考虑收绞。额度不足时的取舍以测试为准。
- 成功则按规则扣除橡木额度、余量减 1；返回的 `ribs` 为减后余量。减后为 0 则移除该肋骨。
- 无可收绞项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部收绞候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { hauled: Array<{ id; payload; heelAt; flareAt; ribs }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽肋骨。
- 冲刷快照下已成耗尽肋骨且满足撑闩门条件、也未被本次收绞移除的肋骨；`spent` 为这些 id，按首次登记序。不满足撑闩门条件即使已成耗尽肋骨也保留。冲刷不扣额度。
- 按 `haul` 规则反复收绞快照下满足撑闩门条件、仍处于外飘窗内的肋骨，直到额度用尽或没有候选；`hauled` 为各次收绞返回值的顺序。冲刷与收绞谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽肋骨、未满足撑闩门条件者），按首次登记序。
- `size(): number` 与 `ids().length` 相同；未撑与耗尽肋骨均占容量。
- `spanOf(id)` 返回 `{ heelAt, flareAt }` 或 `null`；`ribsOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、撑闩门禁、橡木账本），内部文件名自定；正确性以不变量与测试为准。收绞候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
