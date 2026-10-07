## 简述

实现进程内按铺设窗登记的船板舱：板列只在铺设窗内可被钉固；钉固还受夹持与钉额约束。容量、夹持与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`StrakeBay`，以及错误类 `StrakeBayError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidPassesError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new StrakeBay({
  clock,
  maxStrakes?: number,    // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

板列字段：`id`、`payload`、`layAt`、`setAt`、`passes`（正整数，表示仍可钉固的余量；每次成功钉固消耗 1 次余量）。

铺设窗相对当前 `now` 可能完全在过去或未来。窗外的板列仍登记、仍占容量：尚未进入窗的不可钉固；已经越过窗尾的称为耗尽板，占用容量直到被冲刷或钉固至余量为 0。窗边界（`now` 恰好落在 `layAt` / `setAt` 上是否可钉固）以测试为准。

`lay(id, payload, layAt, setAt, passes?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `layAt` / `setAt` 须为有限整数且 `>= 0`，且 `setAt > layAt`，否则 `InvalidSpanError`。
- `passes` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidPassesError`。
- 新 id 且登记数已达 `maxStrakes` → `CapacityError`。
- 已存在：覆盖 `payload` / `layAt` / `setAt` / `passes`（余量重置为新值），返回 `updated`；不改变首次登记序。夹持是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新板列的默认夹持状态以测试为准（不要假设与其它题相同）。

`respan(id, layAt, setAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/passes/首次序不变，`true`。夹持是否随 respan 变化以测试为准。未夹持时也可 respan。

`scrap(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除夹持记录），`true`；不存在 `false`。钉固不退还已消耗的钉额。

`clamp(id): boolean` / `unclamp(id): boolean` / `isClamped(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isClamped` 对不存在同样抛 `UnknownIdError`）。
- `clamp`：已夹仍 `true`（幂等）；夹持不释放容量，板列仍计入 `size` / `ids`。
- `unclamp`：已松仍 `true`（幂等）。夹持如何影响 peek / fasten / 冲刷，以测试为准（不要假设「掩住即不可见」或「松才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用钉额，返回授予后余额。

`credit(): number` — 当前可用钉额（非负整数）。

钉固候选：当前处于铺设窗内、满足夹持条件、且余量 `>= 1`。peek / fasten / liveIds 都不清除耗尽板。冲刷耗尽板不消耗钉额。每次成功钉固消耗的钉额如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; layAt; setAt; passes } | null`

- 在钉固候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`passes` 为当前余量）。

`fasten(): { id; payload; layAt; setAt; passes } | null`

- 在钉固候选中按与 peek 相同次序考虑钉固。额度不足时的取舍以测试为准。
- 成功则按规则扣除钉额、余量减 1；返回的 `passes` 为减后余量。减后为 0 则移除该板。
- 无可钉固项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部钉固候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { fastened: Array<{ id; payload; layAt; setAt; passes }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽板。
- 冲刷快照下已成耗尽板且满足夹持条件、也未被本次钉固移除的板列；`spent` 为这些 id，按首次登记序。不满足夹持条件即使已成耗尽板也保留。冲刷不扣额度。
- 按 `fasten` 规则反复钉固快照下满足夹持条件、仍处于铺设窗内的板列，直到额度用尽或没有候选；`fastened` 为各次钉固返回值的顺序。冲刷与钉固谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽板、未夹持），按首次登记序。
- `size(): number` 与 `ids().length` 相同；未夹持与耗尽板均占容量。
- `spanOf(id)` 返回 `{ layAt, setAt }` 或 `null`；`passesOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、夹持门禁、钉额账本），内部文件名自定；正确性以不变量与测试为准。钉固候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
