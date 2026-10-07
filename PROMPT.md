## 简述

实现进程内按叉树窗登记的桅顶横杆舱：横杆只在叉树窗内可被收绞；收绞还受捆扎闩与索额约束。容量、捆扎与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`Crosstree`，以及错误类 `CrosstreeError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidArmsError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new Crosstree({
  clock,
  maxNests?: number,      // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

横杆字段：`id`、`payload`、`nestAt`、`tipAt`、`arms`（正整数，表示仍可收绞的余量；每次成功收绞消耗 1 档余量）。

叉树窗相对当前 `now` 可能完全在过去或未来。窗外的横杆仍登记、仍占容量：尚未进入窗的不可收绞；已经越过窗尾的称为耗尽横杆，占用容量直到被冲刷或收绞至余量为 0。窗边界（`now` 恰好落在 `nestAt` / `tipAt` 上是否可收绞）以测试为准。

`nest(id, payload, nestAt, tipAt, arms?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `nestAt` / `tipAt` 须为有限整数且 `>= 0`，且 `tipAt > nestAt`，否则 `InvalidSpanError`。
- `arms` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidArmsError`。
- 新 id 且登记数已达 `maxNests` → `CapacityError`。
- 已存在：覆盖 `payload` / `nestAt` / `tipAt` / `arms`（余量重置为新值），返回 `updated`；不改变首次登记序。捆扎是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新横杆的默认捆扎状态以测试为准（不要假设与其它题相同）。

`shift(id, nestAt, tipAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/arms/首次序不变，`true`。捆扎是否随 shift 变化以测试为准。已捆时也可 shift。

`cull(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除捆扎记录），`true`；不存在 `false`。收绞不退还已消耗的索额。

`lash(id): boolean` / `unlash(id): boolean` / `isLashed(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isLashed` 对不存在同样抛 `UnknownIdError`）。
- `lash`：已捆仍 `true`（幂等）；捆扎不释放容量，横杆仍计入 `size` / `ids`。
- `unlash`：已松仍 `true`（幂等）。捆扎如何影响 peek / heave / 冲刷，以测试为准（不要假设「松才可作业」或「捆才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用索额，返回授予后余额。

`credit(): number` — 当前可用索额（非负整数）。

收绞候选：当前处于叉树窗内、满足捆扎门条件、且余量 `>= 1`。peek / heave / liveIds 都不清除耗尽横杆。冲刷耗尽横杆不消耗索额。每次成功收绞消耗的额度如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; nestAt; tipAt; arms } | null`

- 在收绞候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`arms` 为当前余量）。

`heave(): { id; payload; nestAt; tipAt; arms } | null`

- 在收绞候选中按与 peek 相同次序考虑收绞。额度不足时的取舍以测试为准。
- 成功则按规则扣除索额、余量减 1；返回的 `arms` 为减后余量。减后为 0 则移除该横杆。
- 无可收绞项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部收绞候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { heaved: Array<{ id; payload; nestAt; tipAt; arms }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽横杆。
- 冲刷快照下已成耗尽横杆且满足捆扎门条件、也未被本次收绞移除的横杆；`spent` 为这些 id，按首次登记序。不满足捆扎门条件即使已成耗尽横杆也保留。冲刷不扣额度。
- 按 `heave` 规则反复收绞快照下满足捆扎门条件、仍处于叉树窗内的横杆，直到额度用尽或没有候选；`heaved` 为各次收绞返回值的顺序。冲刷与收绞谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽横杆、未满足捆扎门条件者），按首次登记序。
- `size(): number` 与 `ids().length` 相同；未捆与耗尽横杆均占容量。
- `spanOf(id)` 返回 `{ nestAt, tipAt }` 或 `null`；`armsOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、捆扎门禁、索账本），内部文件名自定；正确性以不变量与测试为准。收绞候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
