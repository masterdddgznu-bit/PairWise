## 简述

实现进程内按成熟窗登记的码头仓：货箱只在成熟窗内可被装船；装船还受停泊截止与过路过费约束。容量、停泊与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`MoorBin`，以及错误类 `MoorBinError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidHoldError` / `InvalidWeightError` / `InvalidTollError` / `InvalidUntilError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new MoorBin({
  clock,
  maxCrates?: number,     // 默认 10，整数 >= 1
  initialPurse?: number,  // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

货箱字段：`id`、`payload`、`ripeAt`、`rotAt`、`weight`（正整数，只影响取出次序）、`toll`（正整数，装船时从钱袋扣除）。

成熟：`ripeAt <= now` 且 `now < rotAt`（闭开区间）。未成熟或已过 rot 的货箱仍登记、仍占容量，只是不可装船。已过 rot 的货箱称为腐坏，占用容量直到被冲刷或卸掉。

`stow(id, payload, ripeAt, rotAt, weight?: number, toll?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `ripeAt` / `rotAt` 须为有限整数且 `>= 0`，且 `rotAt > ripeAt`，否则 `InvalidHoldError`。允许窗口相对当前 `now` 完全在过去或未来。
- `weight` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidWeightError`。
- `toll` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidTollError`。
- 新 id 且登记数已达 `maxCrates` → `CapacityError`。
- 已存在：覆盖 `payload` / `ripeAt` / `rotAt` / `weight` / `toll`，返回 `updated`；不改变首次入仓序，也不改变停泊截止。
- 新 id：`accepted`，追加到首次入仓序尾；新货箱默认未停泊。

`restow(id, ripeAt, rotAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/weight/toll/停泊/首次序不变，`true`。停泊中也可 restow。

`reweigh(id, weight): boolean` — 非法重量抛错；不存在 `false`；存在只改 weight，其余不变，`true`。

`dump(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除停泊），`true`；不存在 `false`。卸掉不退还已消耗的过费。

`moor(id, until): boolean` / `unmoor(id): boolean` / `isMoored(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isMoored` 对不存在同样抛 `UnknownIdError`）。
- `until` 须为有限整数 `>= 0`，否则 `InvalidUntilError`。
- `moor` 把停泊截止设为 `until`；仍停泊的货箱不可装船、不可被 drive 当作腐坏冲刷。停泊不释放容量。
- `unmoor` 解除停泊（幂等仍 `true`）。
- 查询 `isMoored` 无副作用。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加钱袋余额，返回授予后余额。

`purse(): number` — 当前可用过费（非负整数）。

取出候选：当前成熟且未停泊。peek / pop / liveIds 都不自动清除已腐坏的货箱。冲刷腐坏不消耗过费。

`peek(): { id; payload; ripeAt; rotAt; weight; toll } | null`

- 在取出候选中按稳定次序取一项；不移除、不扣过费。无候选 → `null`。
- peek 忽略钱袋是否足够（过费不足仍可 peek 到该项）。

`pop(): { id; payload; ripeAt; rotAt; weight; toll } | null`

- 在取出候选中按与 peek 相同次序扫描，装走第一个 `toll <= purse` 的货箱并移除，扣减等额过费。
- 若队头额度不足，跳过它继续找后续可负担项；被跳过的项仍登记、停泊状态不变。
- 无可负担候选 → `null`（不扣过费）。

`liveIds(): string[]` — 当前全部取出候选 id，排序与连续 peek 次序一致（不移除、不扣过费）。含额度不足者。

`drive(): { shipped: Array<{ id; payload; ripeAt; rotAt; weight; toll }>; dumped: string[] }`

- 以调用开始时的 `now` 为快照判定成熟与腐坏。
- 反复按 `pop` 规则装走快照下可负担、未停泊、仍成熟的货箱，直到无法再取；`shipped` 为装船顺序。
- 然后清除快照下已腐坏且未停泊、也未被本次装走的货箱；`dumped` 为这些 id，按首次入仓序。停泊中即使已腐坏也保留。冲刷不扣过费。

查询：

- `ids(): string[]` 全部仍登记 id（含未成熟、已腐坏、停泊），按首次入仓序。
- `size(): number` 与 `ids().length` 相同；停泊与腐坏均占容量。
- `holdOf(id)` 返回 `{ ripeAt, rotAt }` 或 `null`；`weightOf` / `tollOf` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、停泊门禁、过费账本），内部文件名自定；正确性以不变量与测试为准。取出候选的并列次序以测试为准。停泊是否仍生效，以墙钟与 `until` 的边界测例为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
