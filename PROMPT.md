## 简述

实现进程内带 TTL、LRU 与 pin 保护的映射：写入与读取刷新触碰序；容量紧张时先淘汰已过期项，再在未 pin 的存活项中按触碰最旧者腾位；被 pin 的 key 不会被 LRU 挤出，但仍会按 TTL 失效。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`AgeEvict`，以及错误类 `AgeEvictError` 和至少 `InvalidConfigError` / `InvalidKeyError` / `CapacityError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new AgeEvict({
  clock,
  ttlMs,
  maxItems?: number,
})
```

- `ttlMs` 整数 `>= 1`。
- `maxItems` 默认 16、整数 `>= 1`。
- 非法配置抛 `InvalidConfigError`。

每项语义：`value`、`deadline = 最近一次写入时 now + ttlMs`、`touchedAt`（最近触碰）、是否 pin、以及全局触碰序（最旧→最新）。容量按**当前仍登记的 key 数**计（含已过期未清、含已 pin）。

有效：`now < deadline`（`now === deadline` 已过期）。

**逐出/清扫不变量（何为对，非实现剧本）**

- 任何需要腾出容量的路径，必须先清掉**所有**已过期项（不论是否 pin），再考虑 LRU。
- LRU 受害者只能是**未 pin 且仍登记**的项中触碰最旧者；已 pin 项不可被 LRU 挤出。
- 若清完过期后仍满，且不存在可 LRU 逐出的未 pin 项，则新 key 的 `set` 抛 `CapacityError`（已存在 key 的覆盖更新不受此限）。
- `drive` 清除所有已过期项（含 pin），返回被删 key；排序按**触碰序最旧→最新**。
- `get` 对单键：过期则删除并返回 `undefined`；命中有效则只更新触碰序与 `touchedAt`，**不**延长 `deadline`。
- `set` 覆盖已存在 key（含过期未清）：刷新 value / deadline / touchedAt，移到触碰最新端，保持原 pin 状态，返回 `updated`，且**不**因满容去逐出其它项。
- `set` 插入新 key 且当前未满：直接插入；**不会**只因时间推进而批量清其它过期项（未满时过期可残留，直到 `get`/`drive`/满容腾位路径）。
- `pin` / `unpin` 只作用于当前已登记的 key；缺失返回 `false`。pin 不改 TTL。`delete` 同时去掉登记与 pin。
- `set`/`get`/`pin`/`unpin`/`delete`/`deadlineOf`/`touchedAtOf`/`isPinned` 对非法（空）key 抛 `InvalidKeyError`。

`set(key, value): { status: 'accepted' | 'updated'; evicted?: string[] }`

- 新 key 腾位时，`evicted` 含本次清除的过期 key（触碰序）以及随后的至多一个 LRU 受害者；无逐出时可省略或 `[]`（测例用 `evicted ?? []`）。

`get` / `delete` / `drive` / `pin` / `unpin` / `isPinned` / `keys` / `size` / `deadlineOf` / `touchedAtOf`：行为满足上述不变量；`keys()` 为当前登记 key 的触碰序（可含过期未清）。

正确性以不变量与测试为准。宜拆成多模块协作（触碰序、截止时间索引、pin 集合等），但不指定内部文件名。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
