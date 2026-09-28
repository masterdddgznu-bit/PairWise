请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的单副本 Map（put / get / delete / has / keys / size）。请在此基础上迭代实现带 replicaId 的 LWW-Map、tombstone、`merge`、`deltaSince` / `applyDelta`、对端 ACK 与稳定点 GC，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可用内部逻辑时钟（不必驱动 `VirtualClock`，但可保留该类）。

对外入口是 `DeltaMap`（见 `src/map.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new DeltaMap()` 无参：本地 Map
- `put(key, value)` / `get` / `delete` -> boolean / `has` / `keys()`（字典序）/ `size()`
- 基础阶段无 replica、无版本、无 tombstone；delete 直接移除

## 待迭代功能

**构造**
- `new DeltaMap(replicaId: string)`：每个副本有稳定字符串 id（如 `"A"`/`"B"`）
- 无参构造仅用于基础测试；feature 测试一律传 `replicaId`

**LWW 条目**
- 每条存活或 tombstone 带 `Dot = { replicaId, counter }` 与可选 `value`
- 本地 `put`：`counter = ++localCounter`，写入存活条目，覆盖同 key
- 本地 `delete`：若 key 当前可见存活，则写 tombstone（新 dot），返回 true；否则 false 且不递增 counte
- `get`/`has`/`keys`/`size` 忽略 tombstone
- **LWW 胜出**：比较 `(counter, replicaId)` 字典序更大者胜（先比 counter，同 counter 比 replicaId 字符串更大者胜）

**merge(other: DeltaMap): void**
- 对 other 中每个 key 的条目，与本地按 LWW 取胜者保留（含 tombstone）
- merge 不改变本地 `localCounter`，但之后本地 put 的 counter 仍基于本地 counte
- 合并后两边再互相 merge 应收敛（同一可见 map）

**Delta**
- `versionVector() -> Record<string, number>`：本副本知识里，每个 replicaId 见过的最大 counter（含 tombstone 的 dot）
- `deltaSince(vv: Record<string, number>) -> Delta`
  - 包含所有 `dot.counter > (vv[dot.replicaId] ?? 0)` 的条目（存活与 tombstone）
  - `Delta = { entries: { key, value: string | null, dot }[] }`（`value=null` 表示 tombstone）；按 `key` 升序，同 key 不应重复
- `applyDelta(delta: Delta): void`：按 LWW 合并条目；可超前接受

**ACK / GC**
- `ack(peer: string, vv: Record<string, number>): void`：记录 peer 已确认的 vv（逐维取 max）
- `minAckVV() -> Record<string, number>`：所有已 ack peer 的 vv 逐维 min；若尚无任何 ack，返回 `{}`
- `gc(): number`：删除 tombstone 中满足「对 minAckVV，该 tombstone 的 `dot.counter <= (minAckVV[dot.replicaId] ?? 0)`」的条目，返回删除条数
  - 存活条目不因 gc 删除
  - 无 ack 时 `gc` 返回 0

**可观测**
- `getEntry(key) -> { value: string | null; dot } | undefined`：原始条目（含 tombstone）；无则 undefined
- `peersAcked() -> string[]`：已 ack 过的 peer id 字典序

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/dot.ts` — Dot 比较
- `src/vv.ts` — version vector 工具
- `src/entries.ts` — 条目存储与 LWW
- `src/delta.ts` — delta 抽取/应用
- `src/gc.ts` — ACK 与 GC
- `src/map.ts` — `DeltaMap` 门面
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
