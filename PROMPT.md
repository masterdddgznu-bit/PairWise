## 简述

实现进程内按发芽窗登记的麦芽发芽床：麦堆只在发芽窗内可被取出发窑；取出发还受苫布闸与雾水额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`MaltCouch`，以及错误类 `MaltCouchError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidMistError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new MaltCouch({
  clock,
  maxHeaps?: number,   // 默认 5，整数 >= 1
  initialMist?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

麦堆字段：`id`、`payload`、`couchAt`、`kilnAt`、`mist`（正整数，取出发时消耗雾水额度）。

发芽窗相对当前 `now` 可能完全在过去或未来。窗外的麦堆仍登记、仍占容量：尚未进入窗的不可取出发；已经越过窗尾的称为过芽残堆，占用容量直到被冲刷或取出发。窗边界（`now` 恰好落在 `couchAt` / `kilnAt` 上是否可取出发）以测试为准。

`load(id, payload, couchAt, kilnAt, mist?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `couchAt` / `kilnAt` 须为有限整数且 `>= 0`，且 `kilnAt > couchAt`，否则 `InvalidSpanError`。
- `mist` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidMistError`。
- 新 id 且登记数已达 `maxHeaps` → `CapacityError`。
- 已存在：覆盖 `payload` / `couchAt` / `kilnAt` / `mist`，返回 `updated`；不改变首次登记序。苫布闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新麦堆的默认苫布闸状态以测试为准（不要假设与其它题相同）。

`retune(id, couchAt, kilnAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/mist/首次序不变，`true`。苫布闸是否随 retune 变化以测试为准。苫着时也可 retune。

`drop(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除苫布记录），`true`；不存在 `false`。取出发不退还已消耗的雾水额度。

`sheet(id): boolean` / `unsheet(id): boolean` / `isSheeted(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isSheeted` 对不存在同样抛 `UnknownIdError`）。
- `sheet`：已苫仍 `true`（幂等）；苫布闸不释放容量，麦堆仍计入 `size` / `ids`。
- `unsheet`：已揭仍 `true`（幂等）。苫着的麦堆不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用雾水额度，返回授予后余额。

`mist(): number` — 当前可用雾水额度（非负整数）。

取出发候选：当前处于发芽窗内且苫布闸已揭。peek / pop / ripeIds 都不清除过芽残堆。冲刷过芽残堆不消耗雾水额度。

`peek(): { id; payload; couchAt; kilnAt; mist } | null`

- 在取出发候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; couchAt; kilnAt; mist } | null`

- 在取出发候选中按与 peek 相同次序考虑取出发。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可取出发项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部取出发候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; couchAt; kilnAt; mist }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过芽残堆。
- 冲刷快照下已成过芽残堆且苫布闸已揭、也未被本次取出发的麦堆；`spent` 为这些 id，按首次登记序。苫着即使已成过芽残堆也保留。冲刷不扣额度。
- 按 `pop` 规则取出发快照下苫布闸已揭、仍处于发芽窗内的麦堆；`drawn` 为取出发顺序。冲刷与取出发谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成过芽残堆、苫着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；苫着与过芽残堆均占容量。
- `spanOf(id)` 返回 `{ couchAt, kilnAt }` 或 `null`；`mistOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、苫布门禁、雾水账本），内部文件名自定；正确性以不变量与测试为准。取出发候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
