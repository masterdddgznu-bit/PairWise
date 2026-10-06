## 简述

实现进程内按鼓风窗登记的风口床：风口只在鼓风窗内可被抽出；抽出还受风门销与鼓风额度约束。容量、销钉与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`TuyereBed`，以及错误类 `TuyereBedError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidWindError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new TuyereBed({
  clock,
  maxNozzles?: number,  // 默认 5，整数 >= 1
  initialWind?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

风口字段：`id`、`payload`、`igniteAt`、`snuffAt`、`wind`（正整数，抽出时消耗鼓风额度）。

鼓风窗相对当前 `now` 可能完全在过去或未来。窗外的风口仍登记、仍占容量：尚未进入窗的不可抽出；已经越过窗尾的称为熄灭残口，占用容量直到被冲刷或抽出。窗边界（`now` 恰好落在 `igniteAt` / `snuffAt` 上是否可抽出）以测试为准。

`mount(id, payload, igniteAt, snuffAt, wind?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `igniteAt` / `snuffAt` 须为有限整数且 `>= 0`，且 `snuffAt > igniteAt`，否则 `InvalidSpanError`。
- `wind` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidWindError`。
- 新 id 且登记数已达 `maxNozzles` → `CapacityError`。
- 已存在：覆盖 `payload` / `igniteAt` / `snuffAt` / `wind`，返回 `updated`；不改变首次登记序。风门销是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新风口的默认风门销状态以测试为准（不要假设与其它题相同）。

`retime(id, igniteAt, snuffAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/wind/首次序不变，`true`。风门销是否随 retime 变化以测试为准。销住时也可 retime。

`eject(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除风门记录），`true`；不存在 `false`。抽出不退还已消耗的鼓风额度。

`pin(id): boolean` / `unpin(id): boolean` / `isPinned(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isPinned` 对不存在同样抛 `UnknownIdError`）。
- `pin`：已销仍 `true`（幂等）；风门销不释放容量，风口仍计入 `size` / `ids`。
- `unpin`：已松仍 `true`（幂等）。销住的风口不可 glance / pull，也不会被 blast 冲刷。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用鼓风额度，返回授予后余额。

`wind(): number` — 当前可用鼓风额度（非负整数）。

抽出候选：当前处于鼓风窗内且风门销已松。glance / pull / liveIds 都不清除熄灭残口。冲刷熄灭残口不消耗鼓风额度。

`glance(): { id; payload; igniteAt; snuffAt; wind } | null`

- 在抽出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- glance 忽略额度是否足够（额度不足仍可 glance 到该项）。

`pull(): { id; payload; igniteAt; snuffAt; wind } | null`

- 在抽出候选中按与 glance 相同次序考虑抽出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、销钉状态不变。
- 无可抽出项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部抽出候选 id，排序与连续 glance 次序一致（不移除、不扣额度）。含额度不足者。

`blast(): { drawn: Array<{ id; payload; igniteAt; snuffAt; wind }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与熄灭残口。
- 冲刷快照下已成熄灭残口且风门销已松、也未被本次抽出的风口；`spent` 为这些 id，按首次登记序。销住即使已成熄灭残口也保留。冲刷不扣额度。
- 按 `pull` 规则抽出快照下风门销已松、仍处于鼓风窗内的风口；`drawn` 为抽出顺序。冲刷与抽出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成熄灭残口、销住），按首次登记序。
- `size(): number` 与 `ids().length` 相同；销住与熄灭残口均占容量。
- `spanOf(id)` 返回 `{ igniteAt, snuffAt }` 或 `null`；`windOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、风门门禁、鼓风账本），内部文件名自定；正确性以不变量与测试为准。抽出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
