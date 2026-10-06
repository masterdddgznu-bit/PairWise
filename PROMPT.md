## 简述

实现进程内按烘窗登记的啤酒花烘房：花袋只在烘窗内可被卸出；卸出还受风门与燃料额度约束。容量、风门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`OastKiln`，以及错误类 `OastKilnError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new OastKiln({
  clock,
  maxPockets?: number,  // 默认 5，整数 >= 1
  initialFuel?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

花袋字段：`id`、`payload`、`loadAt`、`unloadAt`、`cost`（正整数，卸出时消耗燃料）。

烘窗相对当前 `now` 可能完全在过去或未来。窗外的花袋仍登记、仍占容量：尚未进入窗的不可卸出；已经越过 `unloadAt` 的称为过烘，占用容量直到被冲刷或倒掉。窗边界（`now` 恰好落在 `loadAt` / `unloadAt` 上是否可取）以测试为准。

`load(id, payload, loadAt, unloadAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `loadAt` / `unloadAt` 须为有限整数且 `>= 0`，且 `unloadAt > loadAt`，否则 `InvalidSpanError`。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxPockets` → `CapacityError`。
- 已存在：覆盖 `payload` / `loadAt` / `unloadAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变风门状态。
- 新 id：`accepted`，追加到首次登记序尾。新花袋的默认风门状态以测试为准（不要假设与其它题相同）。

`reload(id, loadAt, unloadAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/风门/首次序不变，`true`。封闭风门时也可 reload。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除风门记录），`true`；不存在 `false`。倒掉不退还已消耗的燃料。

`seal(id): boolean` / `vent(id): boolean` / `isSealed(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isSealed` 对不存在同样抛 `UnknownIdError`）。
- `seal`：已封闭仍 `true`（幂等）；封闭不释放容量，花袋仍计入 `size` / `ids`。
- `vent`：已敞开仍 `true`（幂等）。封闭风门的花袋不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用燃料，返回授予后余额。

`fuel(): number` — 当前可用燃料（非负整数）。

取出候选：当前处于烘窗内且风门敞开。peek / pop / ripeIds 都不自动清除过烘花袋。冲刷过烘不消耗燃料。

`peek(): { id; payload; loadAt; unloadAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣燃料。无候选 → `null`。
- peek 忽略额度是否足够（燃料不足仍可 peek 到该项）。

`pop(): { id; payload; loadAt; unloadAt; cost } | null`

- 在取出候选中按与 peek 相同次序扫描，卸出第一个 `cost <= fuel` 的花袋并移除，扣减等额燃料。
- 若队头额度不足，跳过它继续找后续可负担项；被跳过的项仍登记、风门状态不变。
- 无可负担候选 → `null`（不扣燃料）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣燃料）。含额度不足者。

`drive(): { taken: Array<{ id; payload; loadAt; unloadAt; cost }>; flushed: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过烘。
- 冲刷快照下已过烘且风门敞开、也未被本次卸出的花袋；`flushed` 为这些 id，按首次登记序。风门封闭即使已过烘也保留。冲刷不扣燃料。
- 按 `pop` 规则卸出快照下可负担、风门敞开、仍处于烘窗内的花袋；`taken` 为卸出顺序。卸出与冲刷谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已过烘、封闭风门），按首次登记序。
- `size(): number` 与 `ids().length` 相同；封闭与过烘均占容量。
- `spanOf(id)` 返回 `{ loadAt, unloadAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、风门、燃料账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
