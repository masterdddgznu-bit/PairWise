## 简述

实现进程内按灼热窗登记的锻炉生铁床：铁坯只在灼热窗内可被抽出；抽出还受风箱闸与木炭额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`BloomHearth`，以及错误类 `BloomHearthError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidCharError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new BloomHearth({
  clock,
  maxBlooms?: number,   // 默认 5，整数 >= 1
  initialChar?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

铁坯字段：`id`、`payload`、`glowAt`、`chillAt`、`char`（正整数，抽出时消耗木炭额度）。

灼热窗相对当前 `now` 可能完全在过去或未来。窗外的铁坯仍登记、仍占容量：尚未进入窗的不可抽出；已经越过窗尾的称为冷硬残坯，占用容量直到被冲刷或抽出。窗边界（`now` 恰好落在 `glowAt` / `chillAt` 上是否可抽出）以测试为准。

`load(id, payload, glowAt, chillAt, char?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `glowAt` / `chillAt` 须为有限整数且 `>= 0`，且 `chillAt > glowAt`，否则 `InvalidSpanError`。
- `char` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidCharError`。
- 新 id 且登记数已达 `maxBlooms` → `CapacityError`。
- 已存在：覆盖 `payload` / `glowAt` / `chillAt` / `char`，返回 `updated`；不改变首次登记序。风箱闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新铁坯的默认风箱闸状态以测试为准（不要假设与其它题相同）。

`retune(id, glowAt, chillAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/char/首次序不变，`true`。风箱闸是否随 retune 变化以测试为准。闸住时也可 retune。

`drop(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除风箱记录），`true`；不存在 `false`。抽出不退还已消耗的木炭额度。

`latch(id): boolean` / `unlatch(id): boolean` / `isLatched(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isLatched` 对不存在同样抛 `UnknownIdError`）。
- `latch`：已闸仍 `true`（幂等）；风箱闸不释放容量，铁坯仍计入 `size` / `ids`。
- `unlatch`：已松仍 `true`（幂等）。闸住的铁坯不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用木炭额度，返回授予后余额。

`char(): number` — 当前可用木炭额度（非负整数）。

抽出候选：当前处于灼热窗内且风箱闸已松。peek / pop / ripeIds 都不清除冷硬残坯。冲刷冷硬残坯不消耗木炭额度。

`peek(): { id; payload; glowAt; chillAt; char } | null`

- 在抽出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; glowAt; chillAt; char } | null`

- 在抽出候选中按与 peek 相同次序考虑抽出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可抽出项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部抽出候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; glowAt; chillAt; char }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与冷硬残坯。
- 冲刷快照下已成冷硬残坯且风箱闸已松、也未被本次抽出的铁坯；`spent` 为这些 id，按首次登记序。闸住即使已成冷硬残坯也保留。冲刷不扣额度。
- 按 `pop` 规则抽出快照下风箱闸已松、仍处于灼热窗内的铁坯；`drawn` 为抽出顺序。冲刷与抽出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成冷硬残坯、闸住），按首次登记序。
- `size(): number` 与 `ids().length` 相同；闸住与冷硬残坯均占容量。
- `spanOf(id)` 返回 `{ glowAt, chillAt }` 或 `null`；`charOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、风箱门禁、木炭账本），内部文件名自定；正确性以不变量与测试为准。抽出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
