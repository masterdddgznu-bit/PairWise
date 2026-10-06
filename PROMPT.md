## 简述

实现进程内按喷淋窗登记的喷淋臂：醪层装填只在喷淋窗内可被抽出；抽出还受耙闸与热水量额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SpargeArm`，以及错误类 `SpargeArmError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidLiquorError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SpargeArm({
  clock,
  maxCharges?: number,    // 默认 5，整数 >= 1
  initialLiquor?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

装填字段：`id`、`payload`、`primeAt`、`cutoffAt`、`liquor`（正整数，抽出时消耗热水量额度）。

喷淋窗相对当前 `now` 可能完全在过去或未来。窗外的装填仍登记、仍占容量：尚未进入窗的不可抽出；已经越过窗尾的称为余液，占用容量直到被冲刷或抽出。窗边界（`now` 恰好落在 `primeAt` / `cutoffAt` 上是否可抽出）以测试为准。

`fill(id, payload, primeAt, cutoffAt, liquor?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `primeAt` / `cutoffAt` 须为有限整数且 `>= 0`，且 `cutoffAt > primeAt`，否则 `InvalidSpanError`。
- `liquor` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidLiquorError`。
- 新 id 且登记数已达 `maxCharges` → `CapacityError`。
- 已存在：覆盖 `payload` / `primeAt` / `cutoffAt` / `liquor`，返回 `updated`；不改变首次登记序。耙闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新装填的默认耙闸状态以测试为准（不要假设与其它题相同）。

`reprime(id, primeAt, cutoffAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/liquor/首次序不变，`true`。耙闸是否随 reprime 变化以测试为准。耙着时也可 reprime。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除耙闸记录），`true`；不存在 `false`。抽出不退还已消耗的热水量额度。

`engage(id): boolean` / `disengage(id): boolean` / `isEngaged(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isEngaged` 对不存在同样抛 `UnknownIdError`）。
- `engage`：已耙仍 `true`（幂等）；耙闸不释放容量，装填仍计入 `size` / `ids`。
- `disengage`：已揭仍 `true`（幂等）。耙着的装填不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用热水量额度，返回授予后余额。

`liquor(): number` — 当前可用热水量额度（非负整数）。

取出候选：当前处于喷淋窗内且耙闸已揭。peek / pop / ripeIds 都不自动清除余液装填。冲刷余液不消耗热水量额度。

`peek(): { id; payload; primeAt; cutoffAt; liquor } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; primeAt; cutoffAt; liquor } | null`

- 在取出候选中按与 peek 相同次序考虑抽出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可抽出项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; primeAt; cutoffAt; liquor }>; leftover: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与余液。
- 冲刷快照下已成余液且耙闸已揭、也未被本次抽出的装填；`leftover` 为这些 id，按首次登记序。耙着即使已成余液也保留。冲刷不扣额度。
- 按 `pop` 规则抽出快照下耙闸已揭、仍处于喷淋窗内的装填；`drawn` 为抽出顺序。冲刷与抽出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成余液、耙着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；耙着与余液均占容量。
- `spanOf(id)` 返回 `{ primeAt, cutoffAt }` 或 `null`；`liquorOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、耙闸门禁、热水量账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
