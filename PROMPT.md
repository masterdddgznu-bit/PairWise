请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确有序映射 `ExactMap`（set / get / delete / size / keys / clear）。请在此基础上迭代实现确定性 **Fibonacci Heap（最小堆）** `FibHeap`：数值 id 节点句柄、环形双向根表/孩子表、CLRS 风格 link / cut / cascadingCut / consolidate、decreaseKey、delete、meld、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactMap` 与 `FibHeap`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactMap()`
- `set(key: string, value: number)` / `get(key): number | undefined`
- `delete(key): boolean`
- `size()` / `keys(): string[]`（字典序升序）/ `clear()`

## 待迭代功能

**FibHeap**

- `new FibHeap()`
- `insert(key: string, priority: number): number` — 返回节点 id；**更小 priority 优先**（min-heap）。允许重复 key（每次 insert 新节点）
- `findMin(): { id, key, priority } | undefined`
- `extractMin(): { id, key, priority } | undefined`
- `decreaseKey(id: number, newPriority: number): void`
  - 若 `newPriority >` 当前 priority → `FibError`
  - 若 id 不存在 → `FibError`
- `delete(id: number): boolean` — 将 priority 降到 `-Infinity` 量级后 extract（或 cut+extract）；缺失返回 `false`
- `meld(other: FibHeap): void` — 吸收 other 到 this；other 清空并 `frozen`（不应再使用）
- `size()` / `isEmpty()`
- `exportState()` / `static fromState(state)` — 序列化节点（id, key, priority, degree, mark, parentId, childId, leftId, rightId）+ minId + nextId + frozen
- `freeze()` / `stats(): { frozen, size, treeCount, maxDegree, markedCount }`
- `FibError`，稳定 `name`

**Fibonacci 规则（测试锁定 / CLRS 风格）**

1. 根表与孩子表均为环形双向链表
2. `extractMin` 后 `consolidate`：每个 degree 至多一棵根树
3. `decreaseKey`：若破坏堆序，将节点 cut 到根表；若父已标记则 cascading cut
4. mark：被 cut 的非根节点的父被标记；已标记的父再触发 cascading cut
5. min 指针始终指向根中 priority 最小者；**priority 相同则更小 id 胜出**（锁定平局规则）

**导出辅助（须可实现/可测）**

- `link(parent, child)` — Fibonacci link（child 成为 parent 的孩子，degree++）
- `cut(heap, node, parent)` / `cascadingCut(heap, node)`
- `consolidate(heap)` — extractMin 后的 degree 表合并
- `allocateId(nextId)` — 分配节点 id

## 模块划分

- `src/types.ts` — FibNodeState, FibHeapState, FibStats, FibHandle
- `src/errors.ts` — FibError
- `src/node.ts` — FibNode + allocateId
- `src/link.ts` — link
- `src/cut.ts` — cut + cascadingCut
- `src/consolidate.ts` — consolidate
- `src/tree.ts` — FibHeap
- `src/exact.ts` — ExactMap
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
