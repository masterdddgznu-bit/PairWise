## 简述

实现进程内按淬冷窗登记的渣淬槽：渣料只在淬冷窗内可被捞出；捞出还受夹钳闸与熔剂额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SlagQuench`，以及错误类 `SlagQuenchError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidFluxError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SlagQuench({
  clock,
  maxCharges?: number,  // 默认 5，整数 >= 1
  initialFlux?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

渣料字段：`id`、`payload`、`dunkAt`、`liftAt`、`flux`（正整数，捞出时消耗熔剂额度）。

淬冷窗相对当前 `now` 可能完全在过去或未来。窗外的渣料仍登记、仍占容量：尚未进入窗的不可捞出；已经越过窗尾的称为废渣残料，占用容量直到被冲刷或捞出。窗边界（`now` 恰好落在 `dunkAt` / `liftAt` 上是否可捞出）以测试为准。

`store(id, payload, dunkAt, liftAt, flux?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `dunkAt` / `liftAt` 须为有限整数且 `>= 0`，且 `liftAt > dunkAt`，否则 `InvalidSpanError`。
- `flux` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidFluxError`。
- 新 id 且登记数已达 `maxCharges` → `CapacityError`。
- 已存在：覆盖 `payload` / `dunkAt` / `liftAt` / `flux`，返回 `updated`；不改变首次登记序。夹钳闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新渣料的默认夹钳闸状态以测试为准（不要假设与其它题相同）。

`retune(id, dunkAt, liftAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/flux/首次序不变，`true`。夹钳闸是否随 retune 变化以测试为准。夹着时也可 retune。

`drop(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除夹钳记录），`true`；不存在 `false`。捞出不退还已消耗的熔剂额度。

`clamp(id): boolean` / `unclamp(id): boolean` / `isClamped(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isClamped` 对不存在同样抛 `UnknownIdError`）。
- `clamp`：已夹仍 `true`（幂等）；夹钳闸不释放容量，渣料仍计入 `size` / `ids`。
- `unclamp`：已松仍 `true`（幂等）。夹着的渣料不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用熔剂额度，返回授予后余额。

`flux(): number` — 当前可用熔剂额度（非负整数）。

捞出候选：当前处于淬冷窗内且夹钳闸已松。peek / pop / ripeIds 都不清除废渣残料。冲刷废渣残料不消耗熔剂额度。

`peek(): { id; payload; dunkAt; liftAt; flux } | null`

- 在捞出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; dunkAt; liftAt; flux } | null`

- 在捞出候选中按与 peek 相同次序考虑捞出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可捞出项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部捞出候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; dunkAt; liftAt; flux }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与废渣残料。
- 冲刷快照下已成废渣残料且夹钳闸已松、也未被本次捞出的渣料；`spent` 为这些 id，按首次登记序。夹着即使已成废渣残料也保留。冲刷不扣额度。
- 按 `pop` 规则捞出快照下夹钳闸已松、仍处于淬冷窗内的渣料；`drawn` 为捞出顺序。冲刷与捞出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成废渣残料、夹着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；夹着与废渣残料均占容量。
- `spanOf(id)` 返回 `{ dunkAt, liftAt }` 或 `null`；`fluxOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、夹钳门禁、熔剂账本），内部文件名自定；正确性以不变量与测试为准。捞出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
