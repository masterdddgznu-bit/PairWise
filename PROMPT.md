## 简述

实现进程内按加热窗登记的锻模床：模腔只在加热窗内可被打击；打击还受夹具闩与打击额度约束。容量、夹具与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SwageBlock`，以及错误类 `SwageBlockError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidBlowError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SwageBlock({
  clock,
  maxDies?: number,    // 默认 5，整数 >= 1
  initialBlows?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

模腔字段：`id`、`payload`、`heatAt`、`chillAt`、`blow`（正整数，打击时消耗打击额度）。

加热窗相对当前 `now` 可能完全在过去或未来。窗外的模腔仍登记、仍占容量：尚未进入窗的不可打击；已经越过窗尾的称为冷残腔，占用容量直到被冲刷或打击。窗边界（`now` 恰好落在 `heatAt` / `chillAt` 上是否可打击）以测试为准。

`seat(id, payload, heatAt, chillAt, blow?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `heatAt` / `chillAt` 须为有限整数且 `>= 0`，且 `chillAt > heatAt`，否则 `InvalidSpanError`。
- `blow` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidBlowError`。
- 新 id 且登记数已达 `maxDies` → `CapacityError`。
- 已存在：覆盖 `payload` / `heatAt` / `chillAt` / `blow`，返回 `updated`；不改变首次登记序。夹具闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新模腔的默认夹具闩状态以测试为准（不要假设与其它题相同）。

`reshape(id, heatAt, chillAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/blow/首次序不变，`true`。夹具闩是否随 reshape 变化以测试为准。夹住时也可 reshape。

`yank(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除夹具记录），`true`；不存在 `false`。打击不退还已消耗的打击额度。

`clamp(id): boolean` / `unclamp(id): boolean` / `isClamped(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isClamped` 对不存在同样抛 `UnknownIdError`）。
- `clamp`：已夹仍 `true`（幂等）；夹具闩不释放容量，模腔仍计入 `size` / `ids`。
- `unclamp`：已松仍 `true`（幂等）。夹住的模腔不可 peek / strike，也不会被 swage 冲刷。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用打击额度，返回授予后余额。

`blows(): number` — 当前可用打击额度（非负整数）。

打击候选：当前处于加热窗内且夹具闩已松。peek / strike / liveIds 都不清除冷残腔。冲刷冷残腔不消耗打击额度。

`peek(): { id; payload; heatAt; chillAt; blow } | null`

- 在打击候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`strike(): { id; payload; heatAt; chillAt; blow } | null`

- 在打击候选中按与 peek 相同次序考虑打击。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、夹具状态不变。
- 无可打击项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部打击候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`swage(): { struck: Array<{ id; payload; heatAt; chillAt; blow }>; chilled: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与冷残腔。
- 冲刷快照下已成冷残腔且夹具闩已松、也未被本次打击的模腔；`chilled` 为这些 id，按首次登记序。夹住即使已成冷残腔也保留。冲刷不扣额度。
- 按 `strike` 规则打击快照下夹具闩已松、仍处于加热窗内的模腔；`struck` 为打击顺序。冲刷与打击谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成冷残腔、夹住），按首次登记序。
- `size(): number` 与 `ids().length` 相同；夹住与冷残腔均占容量。
- `spanOf(id)` 返回 `{ heatAt, chillAt }` 或 `null`；`blowOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、夹具门禁、打击账本），内部文件名自定；正确性以不变量与测试为准。打击候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
