## 简述

实现进程内按浸泡窗登记的酒花回滤罐：装填只在浸泡窗内可被抽出；抽出还受塞闸与苦度额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`HopBack`，以及错误类 `HopBackError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidIbuError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new HopBack({
  clock,
  maxCharges?: number,  // 默认 5，整数 >= 1
  initialIbu?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

装填字段：`id`、`payload`、`steepAt`、`dumpAt`、`ibu`（正整数，抽出时消耗苦度额度）。

浸泡窗相对当前 `now` 可能完全在过去或未来。窗外的装填仍登记、仍占容量：尚未进入窗的不可抽出；已经越过窗尾的称为耗尽，占用容量直到被冲刷或抽出。窗边界（`now` 恰好落在 `steepAt` / `dumpAt` 上是否可抽出）以测试为准。

`charge(id, payload, steepAt, dumpAt, ibu?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `steepAt` / `dumpAt` 须为有限整数且 `>= 0`，且 `dumpAt > steepAt`，否则 `InvalidSpanError`。
- `ibu` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidIbuError`。
- 新 id 且登记数已达 `maxCharges` → `CapacityError`。
- 已存在：覆盖 `payload` / `steepAt` / `dumpAt` / `ibu`，返回 `updated`；不改变首次登记序。塞闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新装填的默认塞闸状态以测试为准（不要假设与其它题相同）。

`retime(id, steepAt, dumpAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/ibu/首次序不变，`true`。塞闸是否随 retime 变化以测试为准。塞着时也可 retime。

`toss(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除塞闸记录），`true`；不存在 `false`。抽出不退还已消耗的苦度额度。

`plug(id): boolean` / `unplug(id): boolean` / `isPlugged(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isPlugged` 对不存在同样抛 `UnknownIdError`）。
- `plug`：已塞仍 `true`（幂等）；塞闸不释放容量，装填仍计入 `size` / `ids`。
- `unplug`：已揭仍 `true`（幂等）。塞着的装填不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用苦度额度，返回授予后余额。

`ibu(): number` — 当前可用苦度额度（非负整数）。

取出候选：当前处于浸泡窗内且塞闸已揭。peek / pop / ripeIds 都不自动清除耗尽装填。冲刷耗尽不消耗苦度额度。

`peek(): { id; payload; steepAt; dumpAt; ibu } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; steepAt; dumpAt; ibu } | null`

- 在取出候选中按与 peek 相同次序考虑抽出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可抽出项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; steepAt; dumpAt; ibu }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽。
- 冲刷快照下已耗尽且塞闸已揭、也未被本次抽出的装填；`spent` 为这些 id，按首次登记序。塞着即使已耗尽也保留。冲刷不扣额度。
- 按 `pop` 规则抽出快照下塞闸已揭、仍处于浸泡窗内的装填；`drawn` 为抽出顺序。冲刷与抽出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已耗尽、塞着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；塞着与耗尽均占容量。
- `spanOf(id)` 返回 `{ steepAt, dumpAt }` 或 `null`；`ibuOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、塞闸门禁、苦度账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
