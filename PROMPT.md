## 简述

实现进程内按沤麻窗登记的亚麻缸：麻捆只在沤窗内可被捞起；捞起还受沉坠门禁与酶额度约束。容量、沉坠与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`RettVat`，以及错误类 `RettVatError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new RettVat({
  clock,
  maxLots?: number,        // 默认 6，整数 >= 1
  initialEnzyme?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

麻捆字段：`id`、`payload`、`steepAt`、`liftAt`、`cost`（正整数，捞起时消耗酶）。

沤窗相对当前 `now` 可能完全在过去或未来。窗外的麻捆仍登记、仍占容量：尚未进入窗的不可捞起；已经越过 `liftAt` 的称为过沤，占用容量直到被冲刷或倒掉。窗边界（`now` 恰好落在 `steepAt` / `liftAt` 上是否可取）以测试为准。

`steep(id, payload, steepAt, liftAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `steepAt` / `liftAt` 须为有限整数且 `>= 0`，且 `liftAt > steepAt`，否则 `InvalidSpanError`。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxLots` → `CapacityError`。
- 已存在：覆盖 `payload` / `steepAt` / `liftAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变沉坠状态。
- 新 id：`accepted`，追加到首次登记序尾。新麻捆的默认沉坠状态以测试为准（不要假设与其它题相同）。

`resteep(id, steepAt, liftAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/沉坠/首次序不变，`true`。沉坠中也可 resteep。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除沉坠），`true`；不存在 `false`。倒掉不退还已消耗的酶。

`sink(id): boolean` / `unsink(id): boolean` / `isSunk(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isSunk` 对不存在同样抛 `UnknownIdError`）。
- `sink`：已沉坠仍 `true`（幂等）；沉坠不释放容量，麻捆仍计入 `size` / `ids`。
- `unsink`：未沉坠仍 `true`（幂等）。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用酶，返回授予后余额。

`enzyme(): number` — 当前可用酶（非负整数）。

取出候选：当前处于沤窗内且未沉坠。peek / pop / ripeIds 都不自动清除过沤麻捆。冲刷过沤不消耗酶。

`peek(): { id; payload; steepAt; liftAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣酶。无候选 → `null`。
- peek 忽略额度是否足够（酶不足仍可 peek 到该项）。

`pop(): { id; payload; steepAt; liftAt; cost } | null`

- 在取出候选中按与 peek 相同次序扫描，捞起第一个 `cost <= enzyme` 的麻捆并移除，扣减等额酶。
- 若队头额度不足，跳过它继续找后续可负担项；被跳过的项仍登记、沉坠状态不变。
- 无可负担候选 → `null`（不扣酶）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣酶）。含额度不足者。

`drive(): { lifted: Array<{ id; payload; steepAt; liftAt; cost }>; flushed: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过沤。
- 冲刷快照下已过沤且未沉坠、也未被本次捞起的麻捆；`flushed` 为这些 id，按首次登记序。沉坠中即使已过沤也保留。冲刷不扣酶。
- 按 `pop` 规则捞起快照下可负担、未沉坠、仍处于沤窗内的麻捆；`lifted` 为捞起顺序。冲刷与捞起谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已过沤、沉坠），按首次登记序。
- `size(): number` 与 `ids().length` 相同；沉坠与过沤均占容量。
- `spanOf(id)` 返回 `{ steepAt, liftAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、沉坠门禁、酶账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
