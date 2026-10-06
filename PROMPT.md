## 简述

实现进程内按陈化窗登记的克里亚德拉酒垛：酒桶只在陈化窗内可被抽出；抽出还受酒花膜闸与份额额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`Criadera`，以及错误类 `CriaderaError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidShareError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new Criadera({
  clock,
  maxButts?: number,  // 默认 5，整数 >= 1
  initialShare?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

酒桶字段：`id`、`payload`、`fillAt`、`drawAt`、`share`（正整数，抽出时消耗份额额度）。

陈化窗相对当前 `now` 可能完全在过去或未来。窗外的桶仍登记、仍占容量：尚未进入窗的不可抽出；已经越过 `drawAt` 的称为过期，占用容量直到被冲刷或抽出。窗边界（`now` 恰好落在 `fillAt` / `drawAt` 上是否可抽出）以测试为准。

`fill(id, payload, fillAt, drawAt, share?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `fillAt` / `drawAt` 须为有限整数且 `>= 0`，且 `drawAt > fillAt`，否则 `InvalidSpanError`。
- `share` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidShareError`。
- 新 id 且登记数已达 `maxButts` → `CapacityError`。
- 已存在：覆盖 `payload` / `fillAt` / `drawAt` / `share`，返回 `updated`；不改变首次登记序。酒花膜闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新桶的默认酒花膜状态以测试为准（不要假设与其它题相同）。

`restow(id, fillAt, drawAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/share/首次序不变，`true`。酒花膜闸是否随 restow 变化以测试为准。盖着酒花膜时也可 restow。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除酒花膜记录），`true`；不存在 `false`。抽出不退还已消耗的份额额度。

`veil(id): boolean` / `unveil(id): boolean` / `isVeiled(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isVeiled` 对不存在同样抛 `UnknownIdError`）。
- `veil`：已盖仍 `true`（幂等）；酒花膜不释放容量，桶仍计入 `size` / `ids`。
- `unveil`：已揭仍 `true`（幂等）。盖着酒花膜的桶不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用份额额度，返回授予后余额。

`share(): number` — 当前可用份额额度（非负整数）。

取出候选：当前处于陈化窗内且酒花膜已揭。peek / pop / ripeIds 都不自动清除过期桶。冲刷过期不消耗份额额度。

`peek(): { id; payload; fillAt; drawAt; share } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; fillAt; drawAt; share } | null`

- 在取出候选中按与 peek 相同次序考虑抽出。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可抽出项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; fillAt; drawAt; share }>; expired: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过期。
- 冲刷快照下已过期且酒花膜已揭、也未被本次抽出的桶；`expired` 为这些 id，按首次登记序。盖着即使已过期也保留。冲刷不扣额度。
- 按 `pop` 规则抽出快照下酒花膜已揭、仍处于陈化窗内的桶；`drawn` 为抽出顺序。冲刷与抽出谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已过期、盖着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；盖着与过期均占容量。
- `spanOf(id)` 返回 `{ fillAt, drawAt }` 或 `null`；`shareOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、酒花膜门禁、份额账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
