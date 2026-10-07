## 简述

实现进程内按航段窗登记的桨座销闩舱：桨位只在航段窗内可被划桨；划桨还受销闩与划次额度约束。容量、销闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`TholePin`，以及错误类 `TholePinError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidStrokesError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new TholePin({
  clock,
  maxOars?: number,       // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

桨位字段：`id`、`payload`、`readyAt`、`shipAt`、`strokes`（正整数，表示仍可划桨的余量；每次成功划桨消耗 1 次余量）。

航段窗相对当前 `now` 可能完全在过去或未来。窗外的桨位仍登记、仍占容量：尚未进入窗的不可划桨；已经越过窗尾的称为耗尽位，占用容量直到被冲刷或划桨至余量为 0。窗边界（`now` 恰好落在 `readyAt` / `shipAt` 上是否可划桨）以测试为准。

`seat(id, payload, readyAt, shipAt, strokes?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `readyAt` / `shipAt` 须为有限整数且 `>= 0`，且 `shipAt > readyAt`，否则 `InvalidSpanError`。
- `strokes` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidStrokesError`。
- 新 id 且登记数已达 `maxOars` → `CapacityError`。
- 已存在：覆盖 `payload` / `readyAt` / `shipAt` / `strokes`（余量重置为新值），返回 `updated`；不改变首次登记序。销闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新桨位的默认销闩状态以测试为准（不要假设与其它题相同）。

`reship(id, readyAt, shipAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/strokes/首次序不变，`true`。销闩是否随 reship 变化以测试为准。已销时也可 reship。

`scrap(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除销闩记录），`true`；不存在 `false`。划桨不退还已消耗的划次额度。

`pin(id): boolean` / `unpin(id): boolean` / `isPinned(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isPinned` 对不存在同样抛 `UnknownIdError`）。
- `pin`：已销仍 `true`（幂等）；销闩不释放容量，桨位仍计入 `size` / `ids`。
- `unpin`：已松仍 `true`（幂等）。销闩如何影响 peek / stroke / 冲刷，以测试为准（不要假设「松才可作业」或「销才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用划次额度，返回授予后余额。

`credit(): number` — 当前可用划次额度（非负整数）。

划桨候选：当前处于航段窗内、满足销闩条件、且余量 `>= 1`。peek / stroke / liveIds 都不清除耗尽位。冲刷耗尽位不消耗划次额度。每次成功划桨消耗的额度如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; readyAt; shipAt; strokes } | null`

- 在划桨候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`strokes` 为当前余量）。

`stroke(): { id; payload; readyAt; shipAt; strokes } | null`

- 在划桨候选中按与 peek 相同次序考虑划桨。额度不足时的取舍以测试为准。
- 成功则按规则扣除划次额度、余量减 1；返回的 `strokes` 为减后余量。减后为 0 则移除该位。
- 无可划桨项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部划桨候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { stroked: Array<{ id; payload; readyAt; shipAt; strokes }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽位。
- 冲刷快照下已成耗尽位且满足销闩条件、也未被本次划桨移除的桨位；`spent` 为这些 id，按首次登记序。不满足销闩条件即使已成耗尽位也保留。冲刷不扣额度。
- 按 `stroke` 规则反复划桨快照下满足销闩条件、仍处于航段窗内的桨位，直到额度用尽或没有候选；`stroked` 为各次划桨返回值的顺序。冲刷与划桨谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽位、未满足销闩条件者），按首次登记序。
- `size(): number` 与 `ids().length` 相同；未销与耗尽位均占容量。
- `spanOf(id)` 返回 `{ readyAt, shipAt }` 或 `null`；`strokesOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、销闩门禁、划次账本），内部文件名自定；正确性以不变量与测试为准。划桨候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
