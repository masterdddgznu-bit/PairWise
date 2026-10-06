## 简述

实现进程内按过峰窗登记的水车渠闸：水包只在过峰窗内可被牵出；牵出还受闸门闩与流量额度约束。容量、闸门闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`MillRace`，以及错误类 `MillRaceError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidFlowError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new MillRace({
  clock,
  maxParcels?: number,    // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

水包字段：`id`、`payload`、`crestAt`、`spillAt`、`flow`（正整数，牵出时消耗流量额度）。

过峰窗相对当前 `now` 可能完全在过去或未来。窗外的水包仍登记、仍占容量：尚未进入窗的不可牵出；已经越过窗尾的称为耗尽包，占用容量直到被冲刷或牵出。窗边界（`now` 恰好落在 `crestAt` / `spillAt` 上是否可牵出）以测试为准。

`admit(id, payload, crestAt, spillAt, flow?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `crestAt` / `spillAt` 须为有限整数且 `>= 0`，且 `spillAt > crestAt`，否则 `InvalidSpanError`。
- `flow` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidFlowError`。
- 新 id 且登记数已达 `maxParcels` → `CapacityError`。
- 已存在：覆盖 `payload` / `crestAt` / `spillAt` / `flow`，返回 `updated`；不改变首次登记序。闸门闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新水包的默认闸门闩状态以测试为准（不要假设与其它题相同）。

`retune(id, crestAt, spillAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/flow/首次序不变，`true`。闸门闩是否随 retune 变化以测试为准。闩住时也可 retune。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除闩记录），`true`；不存在 `false`。牵出不退还已消耗的流量额度。

`latch(id): boolean` / `unlatch(id): boolean` / `isLatched(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isLatched` 对不存在同样抛 `UnknownIdError`）。
- `latch`：已闩仍 `true`（幂等）；闸门闩不释放容量，水包仍计入 `size` / `ids`。
- `unlatch`：已松仍 `true`（幂等）。闩住的水包不可 peek / haul，也不会被 flush 冲刷。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用流量额度，返回授予后余额。

`credit(): number` — 当前可用流量额度（非负整数）。

牵出候选：当前处于过峰窗内且闸门闩已松。peek / haul / liveIds 都不清除耗尽包。冲刷耗尽包不消耗流量额度。

`peek(): { id; payload; crestAt; spillAt; flow } | null`

- 在牵出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`haul(): { id; payload; crestAt; spillAt; flow } | null`

- 在牵出候选中按与 peek 相同次序考虑牵出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闩状态不变。
- 无可牵出项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部牵出候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`flush(): { hauled: Array<{ id; payload; crestAt; spillAt; flow }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽包。
- 冲刷快照下已成耗尽包且闸门闩已松、也未被本次牵出的水包；`spent` 为这些 id，按首次登记序。闩住即使已成耗尽包也保留。冲刷不扣额度。
- 按 `haul` 规则牵出快照下闸门闩已松、仍处于过峰窗内的水包；`hauled` 为牵出顺序。冲刷与牵出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽包、闩住），按首次登记序。
- `size(): number` 与 `ids().length` 相同；闩住与耗尽包均占容量。
- `spanOf(id)` 返回 `{ crestAt, spillAt }` 或 `null`；`flowOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、闸门门禁、流量账本），内部文件名自定；正确性以不变量与测试为准。牵出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
