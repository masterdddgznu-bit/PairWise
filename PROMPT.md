## 简述

实现进程内按干燥窗登记的拉幅钉架：布片只在干燥窗内可被收幅；收幅还受钩钉闸与风力额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`TenterHook`，以及错误类 `TenterHookError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidGaleError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new TenterHook({
  clock,
  maxPieces?: number,   // 默认 5，整数 >= 1
  initialGale?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

布片字段：`id`、`payload`、`pegAt`、`strikeAt`、`gale`（正整数，收幅时消耗风力额度）。

干燥窗相对当前 `now` 可能完全在过去或未来。窗外的布片仍登记、仍占容量：尚未进入窗的不可收幅；已经越过窗尾的称为过干残片，占用容量直到被冲刷或收幅。窗边界（`now` 恰好落在 `pegAt` / `strikeAt` 上是否可收幅）以测试为准。

`hang(id, payload, pegAt, strikeAt, gale?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `pegAt` / `strikeAt` 须为有限整数且 `>= 0`，且 `strikeAt > pegAt`，否则 `InvalidSpanError`。
- `gale` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidGaleError`。
- 新 id 且登记数已达 `maxPieces` → `CapacityError`。
- 已存在：覆盖 `payload` / `pegAt` / `strikeAt` / `gale`，返回 `updated`；不改变首次登记序。钩钉闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新布片的默认钩钉闸状态以测试为准（不要假设与其它题相同）。

`restretch(id, pegAt, strikeAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/gale/首次序不变，`true`。钩钉闸是否随 restretch 变化以测试为准。钩着时也可 restretch。

`drop(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除钩钉记录），`true`；不存在 `false`。收幅不退还已消耗的风力额度。

`hook(id): boolean` / `unhook(id): boolean` / `isHooked(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isHooked` 对不存在同样抛 `UnknownIdError`）。
- `hook`：已钩仍 `true`（幂等）；钩钉闸不释放容量，布片仍计入 `size` / `ids`。
- `unhook`：已松仍 `true`（幂等）。钩着的布片不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用风力额度，返回授予后余额。

`gale(): number` — 当前可用风力额度（非负整数）。

收幅候选：当前处于干燥窗内且钩钉闸已松。peek / pop / ripeIds 都不清除过干残片。冲刷过干残片不消耗风力额度。

`peek(): { id; payload; pegAt; strikeAt; gale } | null`

- 在收幅候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; pegAt; strikeAt; gale } | null`

- 在收幅候选中按与 peek 相同次序考虑收幅。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可收幅项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部收幅候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { struck: Array<{ id; payload; pegAt; strikeAt; gale }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过干残片。
- 冲刷快照下已成过干残片且钩钉闸已松、也未被本次收幅的布片；`spent` 为这些 id，按首次登记序。钩着即使已成过干残片也保留。冲刷不扣额度。
- 按 `pop` 规则收幅快照下钩钉闸已松、仍处于干燥窗内的布片；`struck` 为收幅顺序。冲刷与收幅谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成过干残片、钩着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；钩着与过干残片均占容量。
- `spanOf(id)` 返回 `{ pegAt, strikeAt }` 或 `null`；`galeOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、钩钉门禁、风力账本），内部文件名自定；正确性以不变量与测试为准。收幅候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
