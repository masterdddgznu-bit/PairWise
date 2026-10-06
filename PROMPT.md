## 简述

实现进程内按缩呢窗登记的水碓：布捆只在缩呢窗内可被捣缩；捣缩还受木栓闸与皂土额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`FullStock`，以及错误类 `FullStockError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidSoapError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new FullStock({
  clock,
  maxBolts?: number,   // 默认 5，整数 >= 1
  initialSoap?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

布捆字段：`id`、`payload`、`millAt`、`beatAt`、`soap`（正整数，捣缩时消耗皂土额度）。

缩呢窗相对当前 `now` 可能完全在过去或未来。窗外的布捆仍登记、仍占容量：尚未进入窗的不可捣缩；已经越过窗尾的称为过缩残捆，占用容量直到被冲刷或捣缩。窗边界（`now` 恰好落在 `millAt` / `beatAt` 上是否可捣缩）以测试为准。

`store(id, payload, millAt, beatAt, soap?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `millAt` / `beatAt` 须为有限整数且 `>= 0`，且 `beatAt > millAt`，否则 `InvalidSpanError`。
- `soap` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidSoapError`。
- 新 id 且登记数已达 `maxBolts` → `CapacityError`。
- 已存在：覆盖 `payload` / `millAt` / `beatAt` / `soap`，返回 `updated`；不改变首次登记序。木栓闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新布捆的默认木栓闸状态以测试为准（不要假设与其它题相同）。

`remill(id, millAt, beatAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/soap/首次序不变，`true`。木栓闸是否随 remill 变化以测试为准。栓着时也可 remill。

`drop(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除木栓记录），`true`；不存在 `false`。捣缩不退还已消耗的皂土额度。

`peg(id): boolean` / `unpeg(id): boolean` / `isPegged(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isPegged` 对不存在同样抛 `UnknownIdError`）。
- `peg`：已栓仍 `true`（幂等）；木栓闸不释放容量，布捆仍计入 `size` / `ids`。
- `unpeg`：已松仍 `true`（幂等）。栓着的布捆不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用皂土额度，返回授予后余额。

`soap(): number` — 当前可用皂土额度（非负整数）。

捣缩候选：当前处于缩呢窗内且木栓闸已松。peek / pop / ripeIds 都不清除过缩残捆。冲刷过缩残捆不消耗皂土额度。

`peek(): { id; payload; millAt; beatAt; soap } | null`

- 在捣缩候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; millAt; beatAt; soap } | null`

- 在捣缩候选中按与 peek 相同次序考虑捣缩。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可捣缩项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部捣缩候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { milled: Array<{ id; payload; millAt; beatAt; soap }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过缩残捆。
- 冲刷快照下已成过缩残捆且木栓闸已松、也未被本次捣缩的布捆；`spent` 为这些 id，按首次登记序。栓着即使已成过缩残捆也保留。冲刷不扣额度。
- 按 `pop` 规则捣缩快照下木栓闸已松、仍处于缩呢窗内的布捆；`milled` 为捣缩顺序。冲刷与捣缩谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成过缩残捆、栓着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；栓着与过缩残捆均占容量。
- `spanOf(id)` 返回 `{ millAt, beatAt }` 或 `null`；`soapOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、木栓门禁、皂土账本），内部文件名自定；正确性以不变量与测试为准。捣缩候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
