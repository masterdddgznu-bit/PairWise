## 简述

实现进程内按焖烧窗登记的匣钵床：匣钵只在焖烧窗内可被抽出；抽出还受抽匣闩与火候额度约束。容量、抽匣闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SaggarBed`，以及错误类 `SaggarBedError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidFireError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SaggarBed({
  clock,
  maxSaggars?: number,    // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

匣钵字段：`id`、`payload`、`soakAt`、`drawAt`、`fire`（正整数，抽出时消耗火候额度）。

焖烧窗相对当前 `now` 可能完全在过去或未来。窗外的匣钵仍登记、仍占容量：尚未进入窗的不可抽出；已经越过窗尾的称为耗尽钵，占用容量直到被冲刷或抽出。窗边界（`now` 恰好落在 `soakAt` / `drawAt` 上是否可抽出）以测试为准。

`load(id, payload, soakAt, drawAt, fire?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `soakAt` / `drawAt` 须为有限整数且 `>= 0`，且 `drawAt > soakAt`，否则 `InvalidSpanError`。
- `fire` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidFireError`。
- 新 id 且登记数已达 `maxSaggars` → `CapacityError`。
- 已存在：覆盖 `payload` / `soakAt` / `drawAt` / `fire`，返回 `updated`；不改变首次登记序。抽匣闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新匣钵的默认抽匣闩状态以测试为准（不要假设与其它题相同）。

`retune(id, soakAt, drawAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/fire/首次序不变，`true`。抽匣闩是否随 retune 变化以测试为准。闩住时也可 retune。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除闩记录），`true`；不存在 `false`。抽出不退还已消耗的火候额度。

`latch(id): boolean` / `unlatch(id): boolean` / `isLatched(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isLatched` 对不存在同样抛 `UnknownIdError`）。
- `latch`：已闩仍 `true`（幂等）；抽匣闩不释放容量，匣钵仍计入 `size` / `ids`。
- `unlatch`：已松仍 `true`（幂等）。闩住的匣钵不可 peek / draw，也不会被 fire 冲刷。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用火候额度，返回授予后余额。

`credit(): number` — 当前可用火候额度（非负整数）。

抽出候选：当前处于焖烧窗内且抽匣闩已松。peek / draw / liveIds 都不清除耗尽钵。冲刷耗尽钵不消耗火候额度。

`peek(): { id; payload; soakAt; drawAt; fire } | null`

- 在抽出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`draw(): { id; payload; soakAt; drawAt; fire } | null`

- 在抽出候选中按与 peek 相同次序考虑抽出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闩状态不变。
- 无可抽出项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部抽出候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`fire(): { drawn: Array<{ id; payload; soakAt; drawAt; fire }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽钵。
- 冲刷快照下已成耗尽钵且抽匣闩已松、也未被本次抽出的匣钵；`spent` 为这些 id，按首次登记序。闩住即使已成耗尽钵也保留。冲刷不扣额度。
- 按 `draw` 规则抽出快照下抽匣闩已松、仍处于焖烧窗内的匣钵；`drawn` 为抽出顺序。冲刷与抽出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽钵、闩住），按首次登记序。
- `size(): number` 与 `ids().length` 相同；闩住与耗尽钵均占容量。
- `spanOf(id)` 返回 `{ soakAt, drawAt }` 或 `null`；`fireOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、抽匣门禁、火候账本），内部文件名自定；正确性以不变量与测试为准。抽出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
