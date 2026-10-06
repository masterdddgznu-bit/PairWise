## 简述

实现进程内按浸蜡窗登记的烛芯架：烛芯只在浸蜡窗内可被提起；提起还受挂钉门禁与蜡额度约束。容量、挂钉与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`WickDip`，以及错误类 `WickDipError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new WickDip({
  clock,
  maxWicks?: number,     // 默认 8，整数 >= 1
  initialWax?: number,   // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

烛芯字段：`id`、`payload`、`hangAt`、`pullAt`、`cost`（正整数，提起时消耗蜡）。

浸蜡窗相对当前 `now` 可能完全在过去或未来。窗外的烛芯仍登记、仍占容量：尚未进入窗的不可提起；已经越过 `pullAt` 的称为过提，占用容量直到被冲刷或剪掉。窗边界（`now` 恰好落在 `hangAt` / `pullAt` 上是否可取）以测试为准。

`hang(id, payload, hangAt, pullAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `hangAt` / `pullAt` 须为有限整数且 `>= 0`，且 `pullAt > hangAt`，否则 `InvalidSpanError`。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxWicks` → `CapacityError`。
- 已存在：覆盖 `payload` / `hangAt` / `pullAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变挂钉状态。
- 新 id：`accepted`，追加到首次登记序尾。新烛芯的默认挂钉状态以测试为准（不要假设与其它题相同）。

`rehang(id, hangAt, pullAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/挂钉/首次序不变，`true`。挂钉中也可 rehang。

`cut(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除挂钉），`true`；不存在 `false`。剪掉不退还已消耗的蜡。

`peg(id): boolean` / `unpeg(id): boolean` / `isPegged(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isPegged` 对不存在同样抛 `UnknownIdError`）。
- `peg`：已挂钉仍 `true`（幂等）；挂钉不释放容量，烛芯仍计入 `size` / `ids`。
- `unpeg`：未挂钉仍 `true`（幂等）。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用蜡，返回授予后余额。

`wax(): number` — 当前可用蜡（非负整数）。

取出候选：当前处于浸蜡窗内且未挂钉。peek / pop / ripeIds 都不自动清除过提烛芯。冲刷过提不消耗蜡。

`peek(): { id; payload; hangAt; pullAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣蜡。无候选 → `null`。
- peek 忽略额度是否足够（蜡不足仍可 peek 到该项）。

`pop(): { id; payload; hangAt; pullAt; cost } | null`

- 在取出候选中按与 peek 相同次序扫描，提起第一个 `cost <= wax` 的烛芯并移除，扣减等额蜡。
- 若队头额度不足，跳过它继续找后续可负担项；被跳过的项仍登记、挂钉状态不变。
- 无可负担候选 → `null`（不扣蜡）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣蜡）。含额度不足者。

`drive(): { dipped: Array<{ id; payload; hangAt; pullAt; cost }>; scrubbed: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过提。
- 按 `pop` 规则提起快照下可负担、未挂钉、仍处于浸蜡窗内的烛芯；`dipped` 为提起顺序。
- 冲刷快照下已过提且未挂钉、也未被本次提起的烛芯；`scrubbed` 为这些 id，按首次登记序。挂钉中即使已过提也保留。冲刷不扣蜡。
- 提起与冲刷谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已过提、挂钉），按首次登记序。
- `size(): number` 与 `ids().length` 相同；挂钉与过提均占容量。
- `spanOf(id)` 返回 `{ hangAt, pullAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、挂钉门禁、蜡账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
