## 简述

实现进程内按冷却窗登记的麦汁冷盘船：麦汁盘只在冷却窗内可被压出；压出还受泡沫闸与比重额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`CoolShip`，以及错误类 `CoolShipError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidGravityError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new CoolShip({
  clock,
  maxPans?: number,  // 默认 5，整数 >= 1
  initialGravity?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

麦汁盘字段：`id`、`payload`、`dropAt`、`rackAt`、`gravity`（正整数，压出时消耗比重额度）。

冷却窗相对当前 `now` 可能完全在过去或未来。窗外的盘仍登记、仍占容量：尚未进入窗的不可压出；已经越过 `rackAt` 的称为变酸，占用容量直到被冲刷或压出。窗边界（`now` 恰好落在 `dropAt` / `rackAt` 上是否可压出）以测试为准。

`drop(id, payload, dropAt, rackAt, gravity?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `dropAt` / `rackAt` 须为有限整数且 `>= 0`，且 `rackAt > dropAt`，否则 `InvalidSpanError`。
- `gravity` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidGravityError`。
- 新 id 且登记数已达 `maxPans` → `CapacityError`。
- 已存在：覆盖 `payload` / `dropAt` / `rackAt` / `gravity`，返回 `updated`；不改变首次登记序。泡沫闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新盘的默认泡沫状态以测试为准（不要假设与其它题相同）。

`restow(id, dropAt, rackAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/gravity/首次序不变，`true`。泡沫闸是否随 restow 变化以测试为准。盖着泡沫时也可 restow。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除泡沫记录），`true`；不存在 `false`。压出不退还已消耗的比重额度。

`foam(id): boolean` / `skim(id): boolean` / `isFoamed(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isFoamed` 对不存在同样抛 `UnknownIdError`）。
- `foam`：已盖仍 `true`（幂等）；泡沫不释放容量，盘仍计入 `size` / `ids`。
- `skim`：已揭仍 `true`（幂等）。盖着泡沫的盘不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用比重额度，返回授予后余额。

`gravity(): number` — 当前可用比重额度（非负整数）。

取出候选：当前处于冷却窗内且泡沫已揭。peek / pop / coolIds 都不自动清除变酸盘。冲刷变酸不消耗比重额度。

`peek(): { id; payload; dropAt; rackAt; gravity } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; dropAt; rackAt; gravity } | null`

- 在取出候选中按与 peek 相同次序考虑压出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可压出项 → `null`（不扣额度）。

`coolIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { racked: Array<{ id; payload; dropAt; rackAt; gravity }>; soured: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与变酸。
- 冲刷快照下已变酸且泡沫已揭、也未被本次压出的盘；`soured` 为这些 id，按首次登记序。盖着即使已变酸也保留。冲刷不扣额度。
- 按 `pop` 规则压出快照下泡沫已揭、仍处于冷却窗内的盘；`racked` 为压出顺序。冲刷与压出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已变酸、盖着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；盖着与变酸均占容量。
- `spanOf(id)` 返回 `{ dropAt, rackAt }` 或 `null`；`gravityOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、泡沫门禁、比重账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
