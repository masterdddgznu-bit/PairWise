## 简述

实现进程内按时间窗登记的工作仓：项只在存活窗内可被取出；取出还受印花额度与熔断门禁约束。容量、熔断与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SpanFuse`，以及错误类 `SpanFuseError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SpanFuse({
  clock,
  maxItems?: number,         // 默认 16，整数 >= 1
  initialStamps?: number,    // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

工作项字段：`id`、`payload`、`readyAt`、`expireAt`、`cost`（正整数，取出时消耗印花）。

存活：`readyAt <= now` 且 `now < expireAt`（闭开区间）。未到期或已结束窗口的项仍登记、仍占容量，只是不可取出。

`arm(id, payload, readyAt, expireAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `readyAt` / `expireAt` 须为有限整数且 `>= 0`，且 `expireAt > readyAt`，否则 `InvalidSpanError`。允许窗口相对当前 `now` 完全在过去或未来。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxItems` → `CapacityError`。
- 已存在：覆盖 `payload` / `readyAt` / `expireAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变熔断状态。
- 新 id：`accepted`，追加到首次登记序尾；新项默认未熔断。

`rearm(id, readyAt, expireAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/熔断/首次序不变，`true`。熔断中也可 rearm。

`cancel(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除熔断），`true`；不存在 `false`。取消不退还已消耗的印花。

`fuse(id): boolean` / `unfuse(id): boolean` / `isFused(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isFused` 对不存在同样抛 `UnknownIdError`）。
- `fuse`：已熔断仍 `true`（幂等）；熔断不释放容量，项仍计入 `size` / `ids`。
- `unfuse`：未熔断仍 `true`（幂等）。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用印花，返回授予后余额。

`stamps(): number` — 当前可用印花（非负整数）。

取出候选：当前存活且未熔断。peek / pop / liveIds 都不自动清除已结束窗口的项。

`peek(): { id; payload; readyAt; expireAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣印花。无候选 → `null`。
- peek 忽略额度是否足够（印花不足仍可 peek 到该项）。

`pop(): { id; payload; readyAt; expireAt; cost } | null`

- 在取出候选中按与 peek 相同次序扫描，取出第一个 `cost <= stamps` 的项并移除，扣减等额印花。
- 若队头额度不足，跳过它继续找后续可负担项；被跳过的项仍登记、熔断状态不变。
- 无可负担候选 → `null`（不扣印花）。

`liveIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣印花）。含额度不足者。

`drive(): { taken: Array<{ id; payload; readyAt; expireAt; cost }>; purged: string[] }`

- 以调用开始时的 `now` 为快照判定存活。
- 反复按 `pop` 规则取出快照下可负担、未熔断、仍存活的项，直到无法再取；`taken` 为取出顺序。
- 然后清除快照下窗口已结束且未熔断、也未被本次取出的项；`purged` 为这些 id，按首次登记序。熔断中即使窗口已结束也保留。

查询：

- `ids(): string[]` 全部仍登记 id（含未到期、已过窗、熔断），按首次登记序。
- `size(): number` 与 `ids().length` 相同；熔断与过窗均占容量。
- `spanOf(id)` 返回 `{ readyAt, expireAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、熔断门禁、印花账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
