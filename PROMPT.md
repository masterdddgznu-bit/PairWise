请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确节点集合 `ExactNodes`（FNV mod n 索引 sorted 列表）。请在此基础上迭代实现确定性 **一致性哈希环** `ConsistentRing`：FNV 虚拟节点、顺时针 assign/successors、节点增删重建、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactNodes` 与 `ConsistentRing`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactNodes()`
- `add(id: string)` / `remove(id: string)`
- `list(): string[]` — 字典序
- `size()`
- `pickExact(key: string): string | null` — `list()[fnv1a32(key, 0) % size()]`；空集 → null
- `clear()`

## 待迭代功能

**哈希（`hash.ts`，测试锁定）**

- FNV-1a 32-bit：`offset = 2166136261`，`prime = 16777619`
- `fnv1a32(data: string, seed = 0): number` — 初态 `(offset ^ seed) >>> 0`；逐字符 `h ^= code; h = imul(h, prime)`；返回 `h >>> 0`
- `fnv32(seed: number, data: string): number` — 等价 `fnv1a32(data, seed)`（seed 为第一参）

**虚拟节点（`vnode.ts`，测试锁定）**

- 物理节点 `id`、vnode 数 `vnodeCount`、种子 `seed`：
  - 对 i = 0..vnodeCount-1：`pos = fnv32(seed, id + '#' + i)`（uint32）
- `vnodePositionsForNode(nodeId, vnodeCount, seed): number[]` — 返回该节点全部 vnode 位置，**升序**

**ConsistentRing（`ring.ts`）**

- `new ConsistentRing(vnodeCount: number, seed: number)` — vnodeCount 为 [1, 256] 整数；否则 `RingError`
- 环：所有 vnode `{pos, id}` 按 `pos` 升序；同 pos 时 **id 字典序较小者优先**
- `addNode(id)` / `removeNode(id)` — 增删物理节点并重建环；重复 add → `RingError`；frozen → `RingError`
- `nodes(): string[]` — sorted 物理 id
- `assign(key: string): string | null` — `h = fnv32(seed, key)`；找第一个 `pos >= h` 的 vnode（顺时针）；若无则 wrap 到环首；空环 → null
- `successors(key: string, k: number): string[]` — 从 assign 点顺时针取 **k 个 distinct 物理节点**（含 primary）；`k < 1` → `RingError`；物理节点不足 k 时返回全部 distinct（保序）
- `vnodePositions(id: string): number[]` — 该物理节点 vnode 位置升序
- `ringSnapshot(): {pos, id}[]` — 环副本（sorted）
- `exportState()` / `static fromState({vnodeCount, seed, nodes})` — 从节点列表重建
- `freeze()` — 之后 add/remove 抛 `RingError`；assign/successors/stats 仍可读
- `stats(): { vnodeCount, seed, frozen, nodeCount, ringSize }`

**错误**
- `RingError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/hash.ts` — FNV-1a、`fnv32`
- `src/vnode.ts` — `vnodePositionsForNode`
- `src/ring.ts` — `ConsistentRing`
- `src/exact.ts` — `ExactNodes`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
