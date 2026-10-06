## 简述

实现进程内按可取窗登记的炭堆成窑：炭丘只在可取窗内可被抽出；抽出还受通风闸与气额约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`CharPile`，以及错误类 `CharPileError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new CharPile({
  clock,
  maxMounds?: number,  // 默认 5，整数 >= 1
  initialAir?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

炭丘字段：`id`、`payload`、`bankAt`、`drawAt`、`cost`（正整数，抽出时消耗气额）。

可取窗相对当前 `now` 可能完全在过去或未来。窗外的炭丘仍登记、仍占容量：尚未进入窗的不可抽出；已经越过 `drawAt` 的称为过火，占用容量直到被冲刷或抽走。窗边界（`now` 恰好落在 `bankAt` / `drawAt` 上是否可取）以测试为准。

`bank(id, payload, bankAt, drawAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `bankAt` / `drawAt` 须为有限整数且 `>= 0`，且 `drawAt > bankAt`，否则 `InvalidSpanError`。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxMounds` → `CapacityError`。
- 已存在：覆盖 `payload` / `bankAt` / `drawAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变闸门状态。
- 新 id：`accepted`，追加到首次登记序尾。新炭丘的默认闸门状态以测试为准（不要假设与其它题相同）。

`rebank(id, bankAt, drawAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/闸门/首次序不变，`true`。闸着时也可 rebank。

`yank(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除闸门记录），`true`；不存在 `false`。抽走不退还已消耗的气额。

`vent(id): boolean` / `unvent(id): boolean` / `isVented(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isVented` 对不存在同样抛 `UnknownIdError`）。
- `vent`：已闸仍 `true`（幂等）；闸门不释放容量，炭丘仍计入 `size` / `ids`。
- `unvent`：已开仍 `true`（幂等）。闸着的炭丘不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用气额，返回授予后余额。

`air(): number` — 当前可用气额（非负整数）。

取出候选：当前处于可取窗内且闸门已开。peek / pop / ripeIds 都不自动清除过火炭丘。冲刷过火不消耗气额。

`peek(): { id; payload; bankAt; drawAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣气额。无候选 → `null`。
- peek 忽略额度是否足够（气额不足仍可 peek 到该项）。

`pop(): { id; payload; bankAt; drawAt; cost } | null`

- 在取出候选中按与 peek 相同次序考虑抽出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可抽出项 → `null`（不扣气额）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣气额）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; bankAt; drawAt; cost }>; spoiled: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过火。
- 冲刷快照下已过火且闸门已开、也未被本次抽出的炭丘；`spoiled` 为这些 id，按首次登记序。闸着即使已过火也保留。冲刷不扣气额。
- 按 `pop` 规则抽出快照下闸门已开、仍处于可取窗内的炭丘；`drawn` 为抽出顺序。冲刷与抽出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已过火、闸着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；闸着与过火均占容量。
- `spanOf(id)` 返回 `{ bankAt, drawAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、闸门门禁、气额账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
