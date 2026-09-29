请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的单副本字符串文档（insert / delete / toString / length）。请在此基础上迭代实现带 replicaId 的 RGA 序列 CRDT：原子 tombstone、`insertAfter` / `deleteById`、并发插入 tie-break、merge、`deltaSince` / `applyDelta`、对端 ACK 与稳定点 GC，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可用内部逻辑计数器（不必驱动 `VirtualClock`，但可保留该类）。

对外入口是 `RgaDoc`（见 `src/doc.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new RgaDoc()` 无参：简单字符数组
- `insert(index, ch)` / `delete(index) -> boolean` / `toString()` / `length()`
- 基础阶段无 replica、无 id、tombstone；delete 直接移除字符

## 待迭代功能

**构造**
- `new RgaDoc(replicaId: string)`：每个副本有稳定字符串 id（如 `"A"`/`"B"`）
- 无参构造仅用于基础测试；feature 测试一律传 `replicaId`

**RGA 语义**
- 每次字符操作产生 `Atom = { id: Dot, value: string | null, leftOrigin: Dot | null }`，`Dot = { replicaId, counter }`；`value === null` 表示 delete 后的 tombstone
- `insertAfter(after: Dot | null, ch: string): Dot` — 在 `after` 之后插入新原子（`leftOrigin = after`），返回新 id
- 可见序列 = 按 RGA 序遍历、跳过 tombstone 后的字符
- **兄弟排序**：同一 `leftOrigin` 下多个子节点，按 Dot **降序** `(counter, replicaId)` 排列（较大 id 更靠近父节点 / 更靠左）
- `deleteById(id: Dot): boolean` — 若该 id 当前可见则 tombstone
- 索引 API（feature 模式）：
  - `insert(index, ch)` — 在可见位置 `index` 插入：等价于 `insertAfter(visibleIds()[index-1] ?? null, ch)`（index=0 插在 head 后）
  - `delete(index)` — tombstone 可见位置 `index` 处的原子
- **merge(other)**：按 id 并集；任一侧 tombstone 则 tombstone；merge 不改变 `localCounter`
- 并发在同一 origin 后 insert：两条都保留，顺序由 Dot 降序决定

**Delta / ACK / GC**
- `versionVector() -> Record<string, number>`：所有 atom（含 tombstone）各 replica 的最大 counte
- `deltaSince(vv) -> Delta`：所有 `id.counter > (vv[replicaId] ?? 0)` 的 atom；`Delta = { atoms: Atom[] }` 按 `(replicaId, counter)` 升序
- `applyDelta(delta)`：合并 atom
- `ack(peer, vv)`、`minAckVV()`、`gc(): number` — GC 满足 `id.counter <= minAckVV[replicaId]` 的 tombstone atom；返回 GC 条数；存活 atom 永不 GC；无 ack 时 gc 返回 0
- `getAtom(id)`、`visibleIds(): Dot[]` 可观测

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/dot.ts` — Dot 比较
- `src/vv.ts` — version vector 工具
- `src/order.ts` — RGA 可见序与兄弟排序
- `src/atoms.ts` — atom 存储与 merge
- `src/delta.ts` — delta 抽取/应用
- `src/gc.ts` — ACK 与 GC
- `src/doc.ts` — `RgaDoc` 门面
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
