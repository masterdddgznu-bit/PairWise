## 简述

实现进程内按开窗登记的舭水泄孔舱：水道只在开窗内可被抽排；抽排还受塞闩与泵额约束。容量、塞闩与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`LimberHole`，以及错误类 `LimberHoleError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidGulpsError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new LimberHole({
  clock,
  maxChannels?: number,   // 默认 5，整数 >= 1
  initialCredit?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

水道字段：`id`、`payload`、`openAt`、`shutAt`、`gulps`（正整数，表示仍可抽排的余量；每次成功抽排消耗 1 次余量）。

开窗相对当前 `now` 可能完全在过去或未来。窗外的水道仍登记、仍占容量：尚未进入窗的不可抽排；已经越过窗尾的称为耗尽道，占用容量直到被冲刷或抽排至余量为 0。窗边界（`now` 恰好落在 `openAt` / `shutAt` 上是否可抽排）以测试为准。

`seat(id, payload, openAt, shutAt, gulps?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `openAt` / `shutAt` 须为有限整数且 `>= 0`，且 `shutAt > openAt`，否则 `InvalidSpanError`。
- `gulps` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidGulpsError`。
- 新 id 且登记数已达 `maxChannels` → `CapacityError`。
- 已存在：覆盖 `payload` / `openAt` / `shutAt` / `gulps`（余量重置为新值），返回 `updated`；不改变首次登记序。塞闩是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新水道的默认塞闩状态以测试为准（不要假设与其它题相同）。

`retune(id, openAt, shutAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/gulps/首次序不变，`true`。塞闩是否随 retune 变化以测试为准。已塞时也可 retune。

`scrap(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除塞闩记录），`true`；不存在 `false`。抽排不退还已消耗的泵额。

`bung(id): boolean` / `unbung(id): boolean` / `isBunged(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isBunged` 对不存在同样抛 `UnknownIdError`）。
- `bung`：已塞仍 `true`（幂等）；塞闩不释放容量，水道仍计入 `size` / `ids`。
- `unbung`：已松仍 `true`（幂等）。塞闩如何影响 peek / drain / 冲刷，以测试为准（不要假设「松才可作业」或「塞才可作业」的其它题习惯）。

`endow(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用泵额，返回授予后余额。

`credit(): number` — 当前可用泵额（非负整数）。

抽排候选：当前处于开窗内、满足塞闩条件、且余量 `>= 1`。peek / drain / liveIds 都不清除耗尽道。冲刷耗尽道不消耗泵额。每次成功抽排消耗的泵额如何计算、额度不足时如何在候选间取舍、余量变化后并列次序是否重算，以测试为准。

`peek(): { id; payload; openAt; shutAt; gulps } | null`

- 在抽排候选中按稳定次序取一项；不移除、不扣额度、不改余量。无候选 → `null`。
- peek 忽略额度是否足够（额度为 0 仍可 peek 到该项，`gulps` 为当前余量）。

`drain(): { id; payload; openAt; shutAt; gulps } | null`

- 在抽排候选中按与 peek 相同次序考虑抽排。额度不足时的取舍以测试为准。
- 成功则按规则扣除泵额、余量减 1；返回的 `gulps` 为减后余量。减后为 0 则移除该道。
- 无可抽排项 → `null`（不扣额度）。

`liveIds(): string[]` — 当前全部抽排候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { drained: Array<{ id; payload; openAt; shutAt; gulps }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与耗尽道。
- 冲刷快照下已成耗尽道且满足塞闩条件、也未被本次抽排移除的水道；`spent` 为这些 id，按首次登记序。不满足塞闩条件即使已成耗尽道也保留。冲刷不扣额度。
- 按 `drain` 规则反复抽排快照下满足塞闩条件、仍处于开窗内的水道，直到额度用尽或没有候选；`drained` 为各次抽排返回值的顺序。冲刷与抽排谁先谁后、额度不足时是否跳过当前头，以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成耗尽道、未满足塞闩条件者），按首次登记序。
- `size(): number` 与 `ids().length` 相同；未塞与耗尽道均占容量。
- `spanOf(id)` 返回 `{ openAt, shutAt }` 或 `null`；`gulpsOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、塞闩门禁、泵额账本），内部文件名自定；正确性以不变量与测试为准。抽排候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
