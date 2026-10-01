请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确路由 `ExactRouter`（addNode / removeNode / nodes / routeExact / clear）。请在此基础上迭代实现确定性 **Rendezvous / HRW** 哈希 `RendezvousHash`：FNV-1a 哈希、整数锁定 rendezvous 分数、加权 pick/topK、exportNodes/fromNodes、needsRebalance 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactRouter` 与 `RendezvousHash`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactRouter()`
- `addNode(id: string, weight?: number)` — 默认 weight=1（基础路由忽略权重，仅登记 id）
- `removeNode(id: string)`
- `nodes(): string[]` — 按 id 字典序
- `size()`
- `routeExact(key: string): string | null` — 在已登记节点中选 **字典序最小** id（确定性占位精确路由）；无节点 → null
- `clear()`

## 待迭代功能

**哈希（`hash.ts`，测试锁定）**

- FNV-1a 32-bit：`offset = 2166136261`，`prime = 16777619`
- `fnv1a32(data: string, seed = 0): number` — 初态 `(offset ^ seed) >>> 0`；逐字符 `h ^= code; h = imul(h, prime)`；返回 `h >>> 0`
- `fnv32ForNode(seed: number, key: string, nodeId: string): number` — `fnv1a32(key + '\0' + nodeId, seed)`

**分数（`score.ts`，测试锁定 — 整数 BigInt 版，避免浮点漂移）**

- `rendezvousScore(seed, key, nodeId, weight): bigint`
- `h = fnv32ForNode(seed, key, nodeId)`（uint32）
- `wMilli = BigInt(Math.floor(weight * 1000))`（weight 须为正有限数；≤0 在 addNode 层抛错）
- `score = BigInt(h) * wMilli`
- 选节点：`score` 最大者胜；同分则 **nodeId 字典序更小** 者胜

**RendezvousHash（`ring.ts`）**

- `new RendezvousHash(seed: number)`
- 内部 `Map<string, number>` 存 id → weight（正有限数；`weight <= 0` 或非有限 → `RendezvousError`）
- `addNode(id, weight=1)` / `removeNode(id)` / `hasNode(id)` / `nodeWeight(id)` — 无节点时 `nodeWeight` 抛 `RendezvousError`
- `pick(key: string): string | null` — 最高分节点；无节点 → null；**frozen 时仍可读**
- `topK(key: string, k: number): string[]` — 按 score 降序、同分 id 升序取前 k；`k < 1` → `RendezvousError`；`k > size` → 返回全部（同样排序）
- `exportNodes(): { id: string; weight: number }[]` — 按 id 字典序
- `static fromNodes(seed: number, nodes: { id: string; weight: number }[]): RendezvousHash`
- `needsRebalance(threshold: number): boolean` — 节点数 < 2 返回 false；否则 `maxWeight / minWeight > threshold` 为 true（min 为当前最小正权重）
- `freeze(): void` — 之后 `addNode` / `removeNode` 抛 `RendezvousError`；`pick` / `topK` / `exportNodes` / `stats` 仍可用
- `stats(): { seed, frozen, size, totalWeight }` — `totalWeight` 为各节点 weight 之和

**错误**
- `RendezvousError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/hash.ts` — FNV-1a、`fnv32ForNode`
- `src/score.ts` — `rendezvousScore`
- `src/ring.ts` — `RendezvousHash`
- `src/exact.ts` — `ExactRouter`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
