## 简述

实现进程内按开放窗登记的导缆孔组：导孔只在开放窗内可被曳引；曳引还受噎塞闩与曳引额度约束。容量、噎塞与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`FairLead`，以及错误类 `FairLeadError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidHaulError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new FairLead({
  clock,
  maxLeads?: number,     // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

导孔字段：`id`、`payload`、`openAt`、`closeAt`、`haul`（正整数，曳引时消耗曳引额度）。

开放窗相对当前 `now` 可能完全在过去或未来。窗外的导孔仍登记、仍占容量：尚未进入窗的不可曳引；已经越过窗尾的称为滑脱孔，占用容量直到被冲刷或曳引。窗边界（`now` 恰好落在 `openAt` / `closeAt` 上是否可曳引）以测试为准。

`rig(id, payload, openAt, closeAt, haul?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `openAt` / `closeAt` 须为有限整数且 `>= 0`，且 `closeAt > openAt`，否则 `InvalidSpanError`。
- `haul` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidHaulError`。
- 新 id 且登记数已达 `maxLeads` → `CapacityError`。
- 已存在：覆盖 `payload` / `openAt` / `closeAt` / `haul`，返回 `updated`；不改变首次登记序。噎塞闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新导孔的默认噎塞闩状态以测试为准（不要假设与其它题相同）。

`reroute(id, openAt, closeAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/haul/首次序不变，`true`。噎塞闩是否随 reroute 变化以测试为准。噎住时也可 reroute。

`cut(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除噎塞记录），`true`；不存在 `false`。曳引不退还已消耗的曳引额度。

`choke(id): boolean` / `unchoke(id): boolean` / `isChoked(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isChoked` 对不存在同样抛 `UnknownIdError`）。
- `choke`：已噎仍 `true`（幂等）；噎塞闩不释放容量，导孔仍计入 `size` / `ids`。
- `unchoke`：已松仍 `true`（幂等）。噎住的导孔不可 peek / haul，也不会被 lead 冲刷。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用曳引额度，返回授予后余额。

`credit(): number` — 当前可用曳引额度（非负整数）。

曳引候选：当前处于开放窗内且噎塞闩已松。peek / haul / liveIds 都不清除滑脱孔。冲刷滑脱孔不消耗曳引额度。

`peek(): { id; payload; openAt; closeAt; haul } | null`

- 在曳引候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`haul(): { id; payload; openAt; closeAt; haul } | null`

- 在曳引候选中按与 peek 相同次序考虑曳引。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、噎塞状态不变。
- 无可曳引项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部曳引候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`lead(): { hauled: Array<{ id; payload; openAt; closeAt; haul }>; slipped: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与滑脱孔。
- 冲刷快照下已成滑脱孔且噎塞闩已松、也未被本次曳引的导孔；`slipped` 为这些 id，按首次登记序。噎住即使已成滑脱孔也保留。冲刷不扣额度。
- 按 `haul` 规则曳引快照下噎塞闩已松、仍处于开放窗内的导孔；`hauled` 为曳引顺序。冲刷与曳引谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成滑脱孔、噎住），按首次登记序。
- `size(): number` 与 `ids().length` 相同；噎住与滑脱孔均占容量。
- `spanOf(id)` 返回 `{ openAt, closeAt }` 或 `null`；`haulOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、噎塞门禁、曳引账本），内部文件名自定；正确性以不变量与测试为准。曳引候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
