## 简述

实现进程内按碾磨窗登记的磨盘料斗：粮批只在碾磨窗内可被啄碾；啄碾还受料鞋闩与袋额约束。容量、料鞋闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`BurrStone`，以及错误类 `BurrStoneError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidBushelError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new BurrStone({
  clock,
  maxLots?: number,       // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

粮批字段：`id`、`payload`、`chargeAt`、`emptyAt`、`bushels`（正整数，表示仍可啄碾的余量；每次啄碾消耗 1 蒲式耳）。

碾磨窗相对当前 `now` 可能完全在过去或未来。窗外的粮批仍登记、仍占容量：尚未进入窗的不可啄碾；已经越过窗尾的称为耗尽批，占用容量直到被冲刷或啄碾至余量为 0。窗边界（`now` 恰好落在 `chargeAt` / `emptyAt` 上是否可啄碾）以测试为准。

`feed(id, payload, chargeAt, emptyAt, bushels?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `chargeAt` / `emptyAt` 须为有限整数且 `>= 0`，且 `emptyAt > chargeAt`，否则 `InvalidSpanError`。
- `bushels` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidBushelError`。
- 新 id 且登记数已达 `maxLots` → `CapacityError`。
- 已存在：覆盖 `payload` / `chargeAt` / `emptyAt` / `bushels`（余量重置为新值），返回 `updated`；不改变首次登记序。料鞋闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新粮批的默认料鞋闩状态以测试为准（不要假设与其它题相同）。

`dress(id, chargeAt, emptyAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/bushels/首次序不变，`true`。料鞋闩是否随 dress 变化以测试为准。闩住时也可 dress。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除闩记录），`true`；不存在 `false`。啄碾不退还已消耗的袋额。

`latch(id): boolean` / `unlatch(id): boolean` / `isLatched(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isLatched` 对不存在同样抛 `UnknownIdError`）。
- `latch`：已闩仍 `true`（幂等）；料鞋闩不释放容量，粮批仍计入 `size` / `ids`。
- `unlatch`：已松仍 `true`（幂等）。闩住的粮批不可 peek / nibble，也不会被 grind 冲刷。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用袋额，返回授予后余额。

`credit(): number` — 当前可用袋额（非负整数）。

啄碾候选：当前处于碾磨窗内、料鞋闩已松、且余量 `>= 1`。peek / nibble / liveIds 都不清除耗尽批。冲刷耗尽批不消耗袋额。每次成功啄碾消耗 **1** 袋额与 **1** 蒲式耳；余量降为 0 时该批立即移除。余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; chargeAt; emptyAt; bushels } | null`

- 在啄碾候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`bushels` 为当前余量）。

`nibble(): { id; payload; chargeAt; emptyAt; bushels } | null`

- 在啄碾候选中按与 peek 相同次序考虑啄碾。额度不足（余额为 0）时返回 `null`，不改登记。
- 成功则扣 1 袋额、余量减 1；返回的 `bushels` 为减后余量。减后为 0 则移除该批。
- 无可啄碾项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部啄碾候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`grind(): { milled: Array<{ id; payload; chargeAt; emptyAt; bushels }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽批。
- 冲刷快照下已成耗尽批且料鞋闩已松、也未被本次啄碾移除的粮批；`spent` 为这些 id，按首次登记序。闩住即使已成耗尽批也保留。冲刷不扣额度。
- 按 `nibble` 规则反复啄碾快照下料鞋闩已松、仍处于碾磨窗内的粮批，直到额度用尽或没有候选；`milled` 为各次啄碾返回值的顺序。冲刷与啄碾谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽批、闩住），按首次登记序。
- `size(): number` 与 `ids().length` 相同；闩住与耗尽批均占容量。
- `spanOf(id)` 返回 `{ chargeAt, emptyAt }` 或 `null`；`bushelsOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、料鞋门禁、袋额账本），内部文件名自定；正确性以不变量与测试为准。啄碾候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
