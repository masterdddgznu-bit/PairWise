## 简述

实现进程内按软化窗登记的树脂熬盘：树脂批次只在软化窗内可被舀出；舀出还受盘盖闸与溶剂额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`ResinPan`，以及错误类 `ResinPanError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidSpiritError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new ResinPan({
  clock,
  maxLots?: number,      // 默认 5，整数 >= 1
  initialSpirit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

批次字段：`id`、`payload`、`softenAt`、`hardenAt`、`spirit`（正整数，舀出时消耗溶剂额度）。

软化窗相对当前 `now` 可能完全在过去或未来。窗外的批次仍登记、仍占容量：尚未进入窗的不可舀出；已经越过窗尾的称为过硬残批，占用容量直到被冲刷或舀出。窗边界（`now` 恰好落在 `softenAt` / `hardenAt` 上是否可舀出）以测试为准。

`charge(id, payload, softenAt, hardenAt, spirit?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `softenAt` / `hardenAt` 须为有限整数且 `>= 0`，且 `hardenAt > softenAt`，否则 `InvalidSpanError`。
- `spirit` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidSpiritError`。
- 新 id 且登记数已达 `maxLots` → `CapacityError`。
- 已存在：覆盖 `payload` / `softenAt` / `hardenAt` / `spirit`，返回 `updated`；不改变首次登记序。盘盖闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新批次的默认盘盖闸状态以测试为准（不要假设与其它题相同）。

`retune(id, softenAt, hardenAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/spirit/首次序不变，`true`。盘盖闸是否随 retune 变化以测试为准。盖着时也可 retune。

`drop(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除盘盖记录），`true`；不存在 `false`。舀出不退还已消耗的溶剂额度。

`cover(id): boolean` / `uncover(id): boolean` / `isCovered(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isCovered` 对不存在同样抛 `UnknownIdError`）。
- `cover`：已盖仍 `true`（幂等）；盘盖闸不释放容量，批次仍计入 `size` / `ids`。
- `uncover`：已揭仍 `true`（幂等）。盖着的批次不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用溶剂额度，返回授予后余额。

`spirit(): number` — 当前可用溶剂额度（非负整数）。

舀出候选：当前处于软化窗内且盘盖闸已揭。peek / pop / ripeIds 都不清除过硬残批。冲刷过硬残批不消耗溶剂额度。

`peek(): { id; payload; softenAt; hardenAt; spirit } | null`

- 在舀出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; softenAt; hardenAt; spirit } | null`

- 在舀出候选中按与 peek 相同次序考虑舀出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可舀出项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部舀出候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; softenAt; hardenAt; spirit }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过硬残批。
- 冲刷快照下已成过硬残批且盘盖闸已揭、也未被本次舀出的批次；`spent` 为这些 id，按首次登记序。盖着即使已成过硬残批也保留。冲刷不扣额度。
- 按 `pop` 规则舀出快照下盘盖闸已揭、仍处于软化窗内的批次；`drawn` 为舀出顺序。冲刷与舀出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成过硬残批、盖着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；盖着与过硬残批均占容量。
- `spanOf(id)` 返回 `{ softenAt, hardenAt }` 或 `null`；`spiritOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、盘盖门禁、溶剂账本），内部文件名自定；正确性以不变量与测试为准。舀出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
