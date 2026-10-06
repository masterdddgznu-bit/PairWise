## 简述

实现进程内按灼窗登记的海草灰窑：晒架只在灼窗内可被舀灰；舀出还受挡板与苏打额度约束。容量、挡板与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`KelpAsh`，以及错误类 `KelpAshError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new KelpAsh({
  clock,
  maxRacks?: number,     // 默认 5，整数 >= 1
  initialSoda?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

晒架字段：`id`、`payload`、`chargeAt`、`drawAt`、`cost`（正整数，舀灰时消耗苏打）。

灼窗相对当前 `now` 可能完全在过去或未来。窗外的晒架仍登记、仍占容量：尚未进入窗的不可舀灰；已经越过 `drawAt` 的称为过灼，占用容量直到被冲刷或耙掉。窗边界（`now` 恰好落在 `chargeAt` / `drawAt` 上是否可取）以测试为准。

`charge(id, payload, chargeAt, drawAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `chargeAt` / `drawAt` 须为有限整数且 `>= 0`，且 `drawAt > chargeAt`，否则 `InvalidSpanError`。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxRacks` → `CapacityError`。
- 已存在：覆盖 `payload` / `chargeAt` / `drawAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变挡板状态。
- 新 id：`accepted`，追加到首次登记序尾。新晒架的默认挡板状态以测试为准（不要假设与其它题相同）。

`recharge(id, chargeAt, drawAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/挡板/首次序不变，`true`。挡着挡板时也可 recharge。

`rake(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除挡板记录），`true`；不存在 `false`。耙掉不退还已消耗的苏打。

`baffle(id): boolean` / `unbaffle(id): boolean` / `isBaffled(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isBaffled` 对不存在同样抛 `UnknownIdError`）。
- `baffle`：已挡仍 `true`（幂等）；挡板不释放容量，晒架仍计入 `size` / `ids`。
- `unbaffle`：已开仍 `true`（幂等）。挡着的晒架不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用苏打，返回授予后余额。

`soda(): number` — 当前可用苏打（非负整数）。

取出候选：当前处于灼窗内且挡板已开。peek / pop / ripeIds 都不自动清除过灼晒架。冲刷过灼不消耗苏打。

`peek(): { id; payload; chargeAt; drawAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣苏打。无候选 → `null`。
- peek 忽略额度是否足够（苏打不足仍可 peek 到该项）。

`pop(): { id; payload; chargeAt; drawAt; cost } | null`

- 在取出候选中按与 peek 相同次序扫描，舀出第一个 `cost <= soda` 的晒架并移除，扣减等额苏打。
- 若队头额度不足，跳过它继续找后续可负担项；被跳过的项仍登记、挡板状态不变。
- 无可负担候选 → `null`（不扣苏打）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣苏打）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; chargeAt; drawAt; cost }>; washed: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过灼。
- 冲刷快照下已过灼且挡板已开、也未被本次舀出的晒架；`washed` 为这些 id，按首次登记序。挡着即使已过灼也保留。冲刷不扣苏打。
- 按 `pop` 规则舀出快照下可负担、挡板已开、仍处于灼窗内的晒架；`drawn` 为舀出顺序。冲刷与舀出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已过灼、挡着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；挡着与过灼均占容量。
- `spanOf(id)` 返回 `{ chargeAt, drawAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、挡板门禁、苏打账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
