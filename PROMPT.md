请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的单副本 Set（add / remove / has / values / size）。请在此基础上迭代实现带 replicaId 的 OR-Set、tombstone、`merge`、`deltaSince` / `applyDelta`、对端 ACK 与稳定点 GC，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可用内部逻辑计数器（不必驱动 `VirtualClock`，但可保留该类）。

对外入口是 `OrSet`（见 `src/set.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new OrSet()` 无参：本地 Set
- `add(elem)` / `remove(elem) -> boolean` / `has` / `values()`（字典序）/ `size()`
- 基础阶段无 replica、无标签、无 tombstone；remove 直接删除

## 待迭代功能

**构造**
- `new OrSet(replicaId: string)`：每个副本有稳定字符串 id（如 `"A"`/`"B"`）
- 无参构造仅用于基础测试；feature 测试一律传 `replicaId`

**OR-Set 语义**
- 每次 `add` 产生唯一 `Dot = { replicaId, counter }` 标签（`localCounter++`）
- 元素**存在**当且仅当至少有一个存活（未 tombstone）标签
- `add(elem)`：写入新标签；若先前已 remove，用新标签 re-add（add-wins）
- `remove(elem)`：若当前可见存在，则 tombstone **该元素全部当前存活标签**（记录被移除的 dot）；返回 true；否则 false 且不递增 counte
- `has` / `values` / `size` 忽略已全 tombstone 的元素
- **merge(other: OrSet)**：标签并集；对每个 tag，任一侧 tombstone 则保持 tombstone；任一非 tombstone tag 存活则元素可见。merge 不改变 `localCounter`
- 并发 add||remove：remove 只 tombstone remove 时刻观测到的 tag；未见过的并发 add 标签在 merge 后存活（经典 add-wins）

**Delta / ACK / GC**
- `versionVector() -> Record<string, number>`：所有 tag（存活+tombstone）中每个 replica 的最大 counte
- `deltaSince(vv) -> Delta`：所有 `dot.counter > (vv[replicaId] ?? 0)` 的 tag 记录
  - `Delta = { adds: { elem, dot }[], removes: { elem, dot }[] }`；按 `elem`、`replicaId`、`counter` 升序
- `applyDelta(delta)`：合并 tag / tombstone
- `ack(peer, vv)`、`minAckVV()`、`gc(): number` — GC 满足 `dot.counter <= minAckVV[replicaId]` 的 tombstone tag 记录；返回 GC 条数；存活 tag 永不 GC；无 ack 时 gc 返回 0
- `getTags(elem) -> { live: Dot[], tomb: Dot[] }` 可观测
- `peersAcked() -> string[]` 字典序

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/dot.ts` — Dot 比较
- `src/vv.ts` — version vector 工具
- `src/tags.ts` — 标签存储与 merge
- `src/delta.ts` — delta 抽取/应用
- `src/gc.ts` — ACK 与 GC
- `src/set.ts` — `OrSet` 门面
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
