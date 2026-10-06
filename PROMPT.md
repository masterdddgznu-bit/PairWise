## 简述

实现进程内按沤窗登记的柳条沤坑：柳把只在沤窗内可被抽出；抽出还受闸门与水量额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`OsierPit`，以及错误类 `OsierPitError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new OsierPit({
  clock,
  maxBundles?: number,  // 默认 5，整数 >= 1
  initialWater?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

柳把字段：`id`、`payload`、`inAt`、`outAt`、`cost`（正整数，抽出时消耗水量）。

沤窗相对当前 `now` 可能完全在过去或未来。窗外的柳把仍登记、仍占容量：尚未进入窗的不可抽出；已经越过 `outAt` 的称为沤败，占用容量直到被冲刷或抽走。窗边界（`now` 恰好落在 `inAt` / `outAt` 上是否可取）以测试为准。

`bind(id, payload, inAt, outAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `inAt` / `outAt` 须为有限整数且 `>= 0`，且 `outAt > inAt`，否则 `InvalidSpanError`。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxBundles` → `CapacityError`。
- 已存在：覆盖 `payload` / `inAt` / `outAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变闸门状态。
- 新 id：`accepted`，追加到首次登记序尾。新柳把的默认闸门状态以测试为准（不要假设与其它题相同）。

`rebind(id, inAt, outAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/闸门/首次序不变，`true`。闸着时也可 rebind。

`yank(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除闸门记录），`true`；不存在 `false`。抽走不退还已消耗的水量。

`sluice(id): boolean` / `unsluice(id): boolean` / `isSluiced(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isSluiced` 对不存在同样抛 `UnknownIdError`）。
- `sluice`：已闸仍 `true`（幂等）；闸门不释放容量，柳把仍计入 `size` / `ids`。
- `unsluice`：已开仍 `true`（幂等）。闸着的柳把不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用水量，返回授予后余额。

`water(): number` — 当前可用水量（非负整数）。

取出候选：当前处于沤窗内且闸门已开。peek / pop / ripeIds 都不自动清除沤败柳把。冲刷沤败不消耗水量。

`peek(): { id; payload; inAt; outAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣水量。无候选 → `null`。
- peek 忽略额度是否足够（水量不足仍可 peek 到该项）。

`pop(): { id; payload; inAt; outAt; cost } | null`

- 在取出候选中按与 peek 相同次序考虑抽出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可抽出项 → `null`（不扣水量）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣水量）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; inAt; outAt; cost }>; spoiled: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与沤败。
- 冲刷快照下已沤败且闸门已开、也未被本次抽出的柳把；`spoiled` 为这些 id，按首次登记序。闸着即使已沤败也保留。冲刷不扣水量。
- 按 `pop` 规则抽出快照下闸门已开、仍处于沤窗内的柳把；`drawn` 为抽出顺序。冲刷与抽出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已沤败、闸着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；闸着与沤败均占容量。
- `spanOf(id)` 返回 `{ inAt, outAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、闸门门禁、水量账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
