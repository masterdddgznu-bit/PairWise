## 简述

实现进程内按熬窗登记的枫糖蒸发锅：糖锅只在熬窗内可被舀出；舀出还受锅盖与柴火额度约束。容量、锅盖与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SapBoil`，以及错误类 `SapBoilError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SapBoil({
  clock,
  maxPans?: number,      // 默认 7，整数 >= 1
  initialWood?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

糖锅字段：`id`、`payload`、`chargeAt`、`drawAt`、`cost`（正整数，舀出时消耗柴火）。

熬窗相对当前 `now` 可能完全在过去或未来。窗外的糖锅仍登记、仍占容量：尚未进入窗的不可舀出；已经越过 `drawAt` 的称为过熬，占用容量直到被冲刷或倒掉。窗边界（`now` 恰好落在 `chargeAt` / `drawAt` 上是否可取）以测试为准。

`charge(id, payload, chargeAt, drawAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `chargeAt` / `drawAt` 须为有限整数且 `>= 0`，且 `drawAt > chargeAt`，否则 `InvalidSpanError`。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxPans` → `CapacityError`。
- 已存在：覆盖 `payload` / `chargeAt` / `drawAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变锅盖状态。
- 新 id：`accepted`，追加到首次登记序尾。新糖锅的默认锅盖状态以测试为准（不要假设与其它题相同）。

`recharge(id, chargeAt, drawAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/锅盖/首次序不变，`true`。盖着锅盖时也可 recharge。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除锅盖记录），`true`；不存在 `false`。倒掉不退还已消耗的柴火。

`lid(id): boolean` / `unlid(id): boolean` / `isLidded(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isLidded` 对不存在同样抛 `UnknownIdError`）。
- `lid`：已盖仍 `true`（幂等）；盖锅不释放容量，糖锅仍计入 `size` / `ids`。
- `unlid`：已开仍 `true`（幂等）。盖着的糖锅不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用柴火，返回授予后余额。

`wood(): number` — 当前可用柴火（非负整数）。

取出候选：当前处于熬窗内且锅盖已开。peek / pop / ripeIds 都不自动清除过熬糖锅。冲刷过熬不消耗柴火。

`peek(): { id; payload; chargeAt; drawAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣柴火。无候选 → `null`。
- peek 忽略额度是否足够（柴火不足仍可 peek 到该项）。

`pop(): { id; payload; chargeAt; drawAt; cost } | null`

- 在取出候选中按与 peek 相同次序扫描，舀出第一个 `cost <= wood` 的糖锅并移除，扣减等额柴火。
- 若队头额度不足，跳过它继续找后续可负担项；被跳过的项仍登记、锅盖状态不变。
- 无可负担候选 → `null`（不扣柴火）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣柴火）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; chargeAt; drawAt; cost }>; boiledOff: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过熬。
- 冲刷快照下已过熬且锅盖已开、也未被本次舀出的糖锅；`boiledOff` 为这些 id，按首次登记序。盖着即使已过熬也保留。冲刷不扣柴火。
- 按 `pop` 规则舀出快照下可负担、锅盖已开、仍处于熬窗内的糖锅；`drawn` 为舀出顺序。冲刷与舀出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已过熬、盖着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；盖着与过熬均占容量。
- `spanOf(id)` 返回 `{ chargeAt, drawAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、锅盖门禁、柴火账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
