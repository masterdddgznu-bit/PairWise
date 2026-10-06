## 简述

实现进程内按熬煮窗登记的沥青熬锅：沥青批次只在熬煮窗内可被舀出；舀出还受锅盖闸与助熔额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`PitchKettle`，以及错误类 `PitchKettleError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidFluxError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new PitchKettle({
  clock,
  maxBatches?: number,   // 默认 5，整数 >= 1
  initialFlux?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

批次字段：`id`、`payload`、`meltAt`、`pourAt`、`flux`（正整数，舀出时消耗助熔额度）。

熬煮窗相对当前 `now` 可能完全在过去或未来。窗外的批次仍登记、仍占容量：尚未进入窗的不可舀出；已经越过窗尾的称为过熬残批，占用容量直到被冲刷或舀出。窗边界（`now` 恰好落在 `meltAt` / `pourAt` 上是否可舀出）以测试为准。

`charge(id, payload, meltAt, pourAt, flux?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `meltAt` / `pourAt` 须为有限整数且 `>= 0`，且 `pourAt > meltAt`，否则 `InvalidSpanError`。
- `flux` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidFluxError`。
- 新 id 且登记数已达 `maxBatches` → `CapacityError`。
- 已存在：覆盖 `payload` / `meltAt` / `pourAt` / `flux`，返回 `updated`；不改变首次登记序。锅盖闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新批次的默认锅盖闸状态以测试为准（不要假设与其它题相同）。

`remelt(id, meltAt, pourAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/flux/首次序不变，`true`。锅盖闸是否随 remelt 变化以测试为准。盖着时也可 remelt。

`drop(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除锅盖记录），`true`；不存在 `false`。舀出不退还已消耗的助熔额度。

`lid(id): boolean` / `unlid(id): boolean` / `isLidded(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isLidded` 对不存在同样抛 `UnknownIdError`）。
- `lid`：已盖仍 `true`（幂等）；锅盖闸不释放容量，批次仍计入 `size` / `ids`。
- `unlid`：已揭仍 `true`（幂等）。盖着的批次不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用助熔额度，返回授予后余额。

`flux(): number` — 当前可用助熔额度（非负整数）。

舀出候选：当前处于熬煮窗内且锅盖闸已揭。peek / pop / ripeIds 都不清除过熬残批。冲刷过熬残批不消耗助熔额度。

`peek(): { id; payload; meltAt; pourAt; flux } | null`

- 在舀出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; meltAt; pourAt; flux } | null`

- 在舀出候选中按与 peek 相同次序考虑舀出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可舀出项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部舀出候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; meltAt; pourAt; flux }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过熬残批。
- 冲刷快照下已成过熬残批且锅盖闸已揭、也未被本次舀出的批次；`spent` 为这些 id，按首次登记序。盖着即使已成过熬残批也保留。冲刷不扣额度。
- 按 `pop` 规则舀出快照下锅盖闸已揭、仍处于熬煮窗内的批次；`drawn` 为舀出顺序。冲刷与舀出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成过熬残批、盖着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；盖着与过熬残批均占容量。
- `spanOf(id)` 返回 `{ meltAt, pourAt }` 或 `null`；`fluxOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、锅盖门禁、助熔账本），内部文件名自定；正确性以不变量与测试为准。舀出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
