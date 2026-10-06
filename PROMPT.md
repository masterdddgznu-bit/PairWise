## 简述

实现进程内按沤窗登记的亚麻沤坑：麻把只在沤窗内可被捞起；捞出还受塞子与碱液额度约束。容量、塞子与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`FlaxSoak`，以及错误类 `FlaxSoakError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidCostError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new FlaxSoak({
  clock,
  maxBundles?: number,  // 默认 6，整数 >= 1
  initialLye?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

麻把字段：`id`、`payload`、`soakAt`、`liftAt`、`cost`（正整数，捞起时消耗碱液）。

沤窗相对当前 `now` 可能完全在过去或未来。窗外的麻把仍登记、仍占容量：尚未进入窗的不可捞起；已经越过 `liftAt` 的称为沤败，占用容量直到被冲刷或抽走。窗边界（`now` 恰好落在 `soakAt` / `liftAt` 上是否可取）以测试为准。

`soak(id, payload, soakAt, liftAt, cost?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `soakAt` / `liftAt` 须为有限整数且 `>= 0`，且 `liftAt > soakAt`，否则 `InvalidSpanError`。
- `cost` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCostError`。
- 新 id 且登记数已达 `maxBundles` → `CapacityError`。
- 已存在：覆盖 `payload` / `soakAt` / `liftAt` / `cost`，返回 `updated`；不改变首次登记序，也不改变塞子状态。
- 新 id：`accepted`，追加到首次登记序尾。新麻把的默认塞子状态以测试为准（不要假设与其它题相同）。

`resoak(id, soakAt, liftAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/cost/塞子/首次序不变，`true`。塞着塞子时也可 resoak。

`pull(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除塞子记录），`true`；不存在 `false`。抽走不退还已消耗的碱液。

`cork(id): boolean` / `uncork(id): boolean` / `isCorked(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isCorked` 对不存在同样抛 `UnknownIdError`）。
- `cork`：已塞仍 `true`（幂等）；塞子不释放容量，麻把仍计入 `size` / `ids`。
- `uncork`：已开仍 `true`（幂等）。塞着的麻把不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用碱液，返回授予后余额。

`lye(): number` — 当前可用碱液（非负整数）。

取出候选：当前处于沤窗内且塞子已开。peek / pop / ripeIds 都不自动清除沤败麻把。冲刷沤败不消耗碱液。

`peek(): { id; payload; soakAt; liftAt; cost } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣碱液。无候选 → `null`。
- peek 忽略额度是否足够（碱液不足仍可 peek 到该项）。

`pop(): { id; payload; soakAt; liftAt; cost } | null`

- 在取出候选中按与 peek 相同次序扫描，捞起第一个 `cost <= lye` 的麻把并移除，扣减等额碱液。
- 若队头额度不足，跳过它继续找后续可负担项；被跳过的项仍登记、塞子状态不变。
- 无可负担候选 → `null`（不扣碱液）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣碱液）。含额度不足者。

`drive(): { lifted: Array<{ id; payload; soakAt; liftAt; cost }>; spoiled: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与沤败。
- 冲刷快照下已沤败且塞子已开、也未被本次捞起的麻把；`spoiled` 为这些 id，按首次登记序。塞着即使已沤败也保留。冲刷不扣碱液。
- 按 `pop` 规则捞起快照下可负担、塞子已开、仍处于沤窗内的麻把；`lifted` 为捞出顺序。冲刷与捞起谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已沤败、塞着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；塞着与沤败均占容量。
- `spanOf(id)` 返回 `{ soakAt, liftAt }` 或 `null`；`costOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、塞子门禁、碱液账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
