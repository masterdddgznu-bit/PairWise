## 简述

实现进程内按可叉窗登记的草垛成堆：草垛只在可叉窗内可被叉走；叉走还受雨布闸与叉额约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`HayRick`，以及错误类 `HayRickError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new HayRick({
  clock,
  maxRicks?: number,  // 默认 5，整数 >= 1
  initialTines?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

草垛字段：`id`、`payload`、`stackAt`、`forkAt`、`cost`（正整数，叉走时消耗叉额）。

可叉窗相对当前 `now` 可能完全在过去或未来。窗外的草垛仍登记、仍占容量：尚未进入窗的不可叉走；已经越过 `forkAt` 的称为沤坏，占用容量直到被冲刷或叉走。窗边界（`now` 恰好落在 `stackAt` / `forkAt` 上是否可叉）以测试为准。

`stack(id, payload, stackAt, forkAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `stackAt` / `forkAt` 须为有限整数且 `>= 0`，且 `forkAt > stackAt`，否则 `InvalidSpanError`。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxRicks` → `CapacityError`。
- 已存在：覆盖 `payload` / `stackAt` / `forkAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变闸门状态。
- 新 id：`accepted`，追加到首次登记序尾。新草垛的默认闸门状态以测试为准（不要假设与其它题相同）。

`restack(id, stackAt, forkAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/闸门/首次序不变，`true`。盖着雨布时也可 restack。

`yank(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除闸门记录），`true`；不存在 `false`。叉走不退还已消耗的叉额。

`sheet(id): boolean` / `unsheet(id): boolean` / `isSheeted(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isSheeted` 对不存在同样抛 `UnknownIdError`）。
- `sheet`：已盖仍 `true`（幂等）；雨布不释放容量，草垛仍计入 `size` / `ids`。
- `unsheet`：已揭仍 `true`（幂等）。盖着雨布的草垛不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用叉额，返回授予后余额。

`tines(): number` — 当前可用叉额（非负整数）。

取出候选：当前处于可叉窗内且雨布已揭。peek / pop / ripeIds 都不自动清除沤坏草垛。冲刷沤坏不消耗叉额。

`peek(): { id; payload; stackAt; forkAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣叉额。无候选 → `null`。
- peek 忽略额度是否足够（叉额不足仍可 peek 到该项）。

`pop(): { id; payload; stackAt; forkAt; cost } | null`

- 在取出候选中按与 peek 相同次序考虑叉走。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可叉走项 → `null`（不扣叉额）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣叉额）。含额度不足者。

`drive(): { lifted: Array<{ id; payload; stackAt; forkAt; cost }>; spoiled: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与沤坏。
- 冲刷快照下已沤坏且雨布已揭、也未被本次叉走的草垛；`spoiled` 为这些 id，按首次登记序。盖着即使已沤坏也保留。冲刷不扣叉额。
- 按 `pop` 规则叉走快照下雨布已揭、仍处于可叉窗内的草垛；`lifted` 为叉走顺序。冲刷与叉走谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已沤坏、盖着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；盖着与沤坏均占容量。
- `spanOf(id)` 返回 `{ stackAt, forkAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、雨布门禁、叉额账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
