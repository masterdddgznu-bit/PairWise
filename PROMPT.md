## 简述

实现进程内按浸泡窗登记的靛蓝染缸：布批只在浸泡窗内可被捞染；捞染还受绑扎闸与颜料额度约束。容量、闸门与额度三者联检，漏一处边界即错。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`WoadVat`，以及错误类 `WoadVatError` 与至少 `InvalidConfigError` / `InvalidIdError` / `InvalidSpanError` / `InvalidPigmentError` / `InvalidAmountError` / `CapacityError` / `UnknownIdError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new WoadVat({
  clock,
  maxLots?: number,      // 默认 5，整数 >= 1
  initialPigment?: number, // 默认 0，整数 >= 0
})
```

非法配置抛 `InvalidConfigError`。

布批字段：`id`、`payload`、`soakAt`、`rinseAt`、`pigment`（正整数，捞染时消耗颜料额度）。

浸泡窗相对当前 `now` 可能完全在过去或未来。窗外的布批仍登记、仍占容量：尚未进入窗的不可捞染；已经越过窗尾的称为过期残批，占用容量直到被冲刷或捞染。窗边界（`now` 恰好落在 `soakAt` / `rinseAt` 上是否可捞染）以测试为准。

`store(id, payload, soakAt, rinseAt, pigment?: number): { status: 'accepted' | 'updated' }`

- `id` 非空字符串，否则 `InvalidIdError`。
- `soakAt` / `rinseAt` 须为有限整数且 `>= 0`，且 `rinseAt > soakAt`，否则 `InvalidSpanError`。
- `pigment` 缺省为 `1`；必须是有限整数 `>= 1`，否则 `InvalidPigmentError`。
- 新 id 且登记数已达 `maxLots` → `CapacityError`。
- 已存在：覆盖 `payload` / `soakAt` / `rinseAt` / `pigment`，返回 `updated`；不改变首次登记序。绑扎闸是否随更新变化以测试为准。
- 新 id：`accepted`，追加到首次登记序尾。新布批的默认绑扎闸状态以测试为准（不要假设与其它题相同）。

`retune(id, soakAt, rinseAt): boolean` — 非法窗抛错；不存在 `false`；存在只改窗口，payload/pigment/首次序不变，`true`。绑扎闸是否随 retune 变化以测试为准。绑着时也可 retune。

`drop(id): boolean` — 非法 id 抛错；存在则移除（腾出容量、清除绑扎记录），`true`；不存在 `false`。捞染不退还已消耗的颜料额度。

`bind(id): boolean` / `unbind(id): boolean` / `isBound(id): boolean`

- 非法 id → `InvalidIdError`；不存在 → `UnknownIdError`（`isBound` 对不存在同样抛 `UnknownIdError`）。
- `bind`：已绑仍 `true`（幂等）；绑扎闸不释放容量，布批仍计入 `size` / `ids`。
- `unbind`：已松仍 `true`（幂等）。绑着的布批不可 peek / pop，也不会被 drive 冲刷。

`grant(amount): number` — `amount` 有限整数 `>= 1`，否则 `InvalidAmountError`；增加可用颜料额度，返回授予后余额。

`pigment(): number` — 当前可用颜料额度（非负整数）。

捞染候选：当前处于浸泡窗内且绑扎闸已松。peek / pop / ripeIds 都不清除过期残批。冲刷过期残批不消耗颜料额度。

`peek(): { id; payload; soakAt; rinseAt; pigment } | null`

- 在捞染候选中按稳定次序取一项；不移除、不扣额度。无候选 → `null`。
- peek 忽略额度是否足够（额度不足仍可 peek 到该项）。

`pop(): { id; payload; soakAt; rinseAt; pigment } | null`

- 在捞染候选中按与 peek 相同次序考虑捞染。
- 队头额度不足时是否跳过后续可负担项，以测试为准；被留下的项仍登记、闸门状态不变。
- 无可捞染项 → `null`（不扣额度）。

`ripeIds(): string[]` — 当前全部捞染候选 id，排序与连续 peek 次序一致（不移除、不扣额度）。含额度不足者。

`drive(): { drawn: Array<{ id; payload; soakAt; rinseAt; pigment }>; spent: string[] }`

- 以调用开始时的 `now` 为快照判定窗内与过期残批。
- 冲刷快照下已成过期残批且绑扎闸已松、也未被本次捞染的布批；`spent` 为这些 id，按首次登记序。绑着即使已成过期残批也保留。冲刷不扣额度。
- 按 `pop` 规则捞染快照下绑扎闸已松、仍处于浸泡窗内的布批；`drawn` 为捞染顺序。冲刷与捞染谁先谁后以测试为准。

查询：

- `ids(): string[]` 全部仍登记 id（含未入窗、已成过期残批、绑着），按首次登记序。
- `size(): number` 与 `ids().length` 相同；绑着与过期残批均占容量。
- `spanOf(id)` 返回 `{ soakAt, rinseAt }` 或 `null`；`pigmentOf(id)` 不存在 → `null`；非法 id 抛错。

宜拆成多模块协作（登记窗、绑扎门禁、颜料账本），内部文件名自定；正确性以不变量与测试为准。捞染候选的并列次序以测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码；测试从 `src/index.ts` 导入。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
