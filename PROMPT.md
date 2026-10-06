## 简述

实现进程内按浸泡窗登记的石灰鞣坑：皮张只在浸泡窗内可被捞出；捞出还受夹持门禁与石灰额度约束。容量、夹持与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`TanPit`，以及错误类 `TanPitError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSoakError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new TanPit({
  clock,
  maxHides?: number,       // 默认 10，整数 >= 1
  initialLime?: number,    // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

皮张字段：`id`、`payload`、`soakAt`、`drainAt`、`cost`（正整数，捞出时消耗石灰）。

浸泡窗相对当前 `now` 可能完全在过去或未来。窗外的皮张仍登记、仍占容量：尚未进入窗的不可捞出；已经越过 `drainAt` 的称为过浸，占用容量直到被冲刷或倒掉。窗边界（`now` 恰好落在 `soakAt` / `drainAt` 上是否可取）以测试为准。

`load(id, payload, soakAt, drainAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `soakAt` / `drainAt` 须为有限整数且 `>= 0`，且 `drainAt > soakAt`，否则 `InvalidSoakError`。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxHides` → `CapacityError`。
- 已存在：覆盖 `payload` / `soakAt` / `drainAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变夹持状态。
- 新 id：`accepted`，追加到首次登记序尾。新皮张的默认夹持状态以测试为准（不要假设与其它题相同）。

`resoak(id, soakAt, drainAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/夹持/首次序不变，`true`。夹持中也可 resoak。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除夹持），`true`；不存在 `false`。倒掉不退还已消耗的石灰。

`clamp(id): boolean` / `unclamp(id): boolean` / `isClamped(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isClamped` 对不存在同样抛 `UnknownIdError`）。
- `clamp`：已夹持仍 `true`（幂等）；夹持不释放容量，皮张仍计入 `size` / `ids`。
- `unclamp`：未夹持仍 `true`（幂等）。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用石灰，返回授予后余额。

`lime(): number` — 当前可用石灰（非负整数）。

取出候选：当前处于浸泡窗内且未夹持。peek / pop / ripeIds 都不自动清除过浸皮张。冲刷过浸不消耗石灰。

`peek(): { id; payload; soakAt; drainAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣石灰。无候选 → `null`。
- peek 忽略额度是否足够（石灰不足仍可 peek 到该项）。

`pop(): { id; payload; soakAt; drainAt; cost } | null`

- 在取出候选中按与 peek 相同次序扫描，捞出第一个 `cost <= lime` 的皮张并移除，扣减等额石灰。
- 若队头额度不足，跳过它继续找后续可负担项；被跳过的项仍登记、夹持状态不变。
- 无可负担候选 → `null`（不扣石灰）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣石灰）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; soakAt; drainAt; cost }>; scrubbed: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过浸。
- 冲刷快照下已过浸且未夹持、也未被本次捞出的皮张；`scrubbed` 为这些 id，按首次登记序。夹持中即使已过浸也保留。冲刷不扣石灰。
- 按 `pop` 规则捞出快照下可负担、未夹持、仍处于浸泡窗内的皮张；`drawn` 为捞出顺序。冲刷与捞出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已过浸、夹持），按首次登记序。
- `size(): number` 与 `ids().length` 相同；夹持与过浸均占容量。
- `soakOf(id)` 返回 `{ soakAt, drainAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、夹持门禁、石灰账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
