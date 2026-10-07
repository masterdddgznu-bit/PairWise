## 简述

实现进程内按舵承窗登记的舵承销舱：舵跟只在舵承窗内可被摆动；摆动还受销闩与弧次额度约束。容量、销闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`Gudgeon`，以及错误类 `GudgeonError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidArcsError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new Gudgeon({
  clock,
  maxHeels?: number,      // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

舵跟字段：`id`、`payload`、`heelAt`、`swingAt`、`arcs`（正整数，表示仍可摆动的余量；每次成功摆动消耗 1 次余量）。

舵承窗相对当前 `now` 可能完全在过去或未来。窗外的舵跟仍登记、仍占容量：尚未进入窗的不可摆动；已经越过窗尾的称为耗尽舵跟，占用容量直到被冲刷或摆动至余量为 0。窗边界（`now` 恰好落在 `heelAt` / `swingAt` 上是否可摆动）以测试为准。

`seat(id, payload, heelAt, swingAt, arcs?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `heelAt` / `swingAt` 须为有限整数且 `>= 0`，且 `swingAt > heelAt`，否则 `InvalidSpanError`。
- `arcs` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidArcsError`。
- 新 id 且登记数已达 `maxHeels` → `CapacityError`。
- 已存在：覆盖 `payload` / `heelAt` / `swingAt` / `arcs`（余量重置为新值），返回 `updated`；不改变首次登记序。销闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新舵跟的默认销闩状态以测试为准（不要假设与其它题相同）。

`retune(id, heelAt, swingAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/arcs/首次序不变，`true`。销闩是否随 retune 变化以测试为准。已销时也可 retune。

`unship(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除销记录），`true`；不存在 `false`。摆动不退还已消耗的弧次额度。

`pin(id): boolean` / `unpin(id): boolean` / `isPinned(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isPinned` 对不存在同样抛 `UnknownIdError`）。
- `pin`：已销仍 `true`（幂等）；销闩不释放容量，舵跟仍计入 `size` / `ids`。
- `unpin`：已松仍 `true`（幂等）。销闩如何影响 peek / swing / 冲刷，以测试为准（不要假设「松才可作业」或「销才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用弧次额度，返回授予后余额。

`credit(): number` — 当前可用弧次额度（非负整数）。

摆动候选：当前处于舵承窗内、满足销闩门条件、且余量 `>= 1`。peek / swing / liveIds 都不清除耗尽舵跟。冲刷耗尽舵跟不消耗弧次额度。每次成功摆动消耗的额度如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; heelAt; swingAt; arcs } | null`

- 在摆动候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`arcs` 为当前余量）。

`swing(): { id; payload; heelAt; swingAt; arcs } | null`

- 在摆动候选中按与 peek 相同次序考虑摆动。额度不足时的取舍以测试为准。
- 成功则按规则扣除弧次额度、余量减 1；返回的 `arcs` 为减后余量。减后为 0 则移除该舵跟。
- 无可摆动项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部摆动候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { swung: Array<{ id; payload; heelAt; swingAt; arcs }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽舵跟。
- 冲刷快照下已成耗尽舵跟且满足销闩门条件、也未被本次摆动移除的舵跟；`spent` 为这些 id，按首次登记序。不满足销闩门条件即使已成耗尽舵跟也保留。冲刷不扣额度。
- 按 `swing` 规则反复摆动快照下满足销闩门条件、仍处于舵承窗内的舵跟，直到额度用尽或没有候选；`swung` 为各次摆动返回值的顺序。冲刷与摆动谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽舵跟、未满足销闩门条件者），按首次登记序。
- `size(): number` 与 `ids().length` 相同；未销与耗尽舵跟均占容量。
- `spanOf(id)` 返回 `{ heelAt, swingAt }` 或 `null`；`arcsOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、销闩门禁、弧次账本），内部文件名自定；正确性以不变量与测试为准。摆动候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
