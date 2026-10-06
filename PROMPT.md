## 简述

实现进程内按霜冻窗登记的霜窖：包裹只在霜冻窗内可被取出；取出还受封霜闸与冷额约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`RimeVault`，以及错误类 `RimeVaultError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidChillError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new RimeVault({
  clock,
  maxParcels?: number,  // 默认 5，整数 >= 1
  initialChill?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

包裹字段：`id`、`payload`、`rimeAt`、`thawAt`、`chill`（正整数，取出时消耗冷额）。

霜冻窗相对当前 `now` 可能完全在过去或未来。窗外的包裹仍登记、仍占容量：尚未进入窗的不可取出；已经越过窗尾的称为解冻残料，占用容量直到被冲刷或取出。窗边界（`now` 恰好落在 `rimeAt` / `thawAt` 上是否可取出）以测试为准。

`store(id, payload, rimeAt, thawAt, chill?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `rimeAt` / `thawAt` 须为有限整数且 `>= 0`，且 `thawAt > rimeAt`，否则 `InvalidSpanError`。
- `chill` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidChillError`。
- 新 id 且登记数已达 `maxParcels` → `CapacityError`。
- 已存在：覆盖 `payload` / `rimeAt` / `thawAt` / `chill`，返回 `updated`；不改变首次登记序。封霜闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新包裹的默认封霜闸状态以测试为准（不要假设与其它题相同）。

`retime(id, rimeAt, thawAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/chill/首次序不变，`true`。封霜闸是否随 retime 变化以测试为准。封着时也可 retime。

`drop(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除封霜记录），`true`；不存在 `false`。取出不退还已消耗的冷额。

`seal(id): boolean` / `unseal(id): boolean` / `isSealed(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isSealed` 对不存在同样抛 `UnknownIdError`）。
- `seal`：已封仍 `true`（幂等）；封霜闸不释放容量，包裹仍计入 `size` / `ids`。
- `unseal`：已揭仍 `true`（幂等）。封着的包裹不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用冷额，返回授予后余额。

`chill(): number` — 当前可用冷额（非负整数）。

取出候选：当前处于霜冻窗内且封霜闸已揭。peek / pop / ripeIds 都不清除解冻残料。冲刷解冻残料不消耗冷额。

`peek(): { id; payload; rimeAt; thawAt; chill } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; rimeAt; thawAt; chill } | null`

- 在取出候选中按与 peek 相同次序考虑取出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可取出项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; rimeAt; thawAt; chill }>; thawed: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与解冻残料。
- 冲刷快照下已成解冻残料且封霜闸已揭、也未被本次取出的包裹；`thawed` 为这些 id，按首次登记序。封着即使已成解冻残料也保留。冲刷不扣额度。
- 按 `pop` 规则取出快照下封霜闸已揭、仍处于霜冻窗内的包裹；`drawn` 为取出顺序。冲刷与取出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成解冻残料、封着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；封着与解冻残料均占容量。
- `spanOf(id)` 返回 `{ rimeAt, thawAt }` 或 `null`；`chillOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、封霜门禁、冷额账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
