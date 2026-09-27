请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的内存 KV（put / get / delete / has / keys / size）。请在此基础上迭代实现 Merkle 根、包含证明、跨实例 LWW `diffAgainst` / `applyDiff`，以及墓碑 TTL + `tick` GC，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖（可用 Node 内置 `crypto`）。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `MerkleKV`（见 `src/kv.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `put(key, value)`：写入/覆盖
- `get(key) -> string | undefined`
- `delete(key) -> boolean`：存在则删除并返回 true，否则 false
- `has(key) -> boolean`
- `keys() -> string[]`：字典序
- `size() -> number`：存活键数量
- 基础阶段无版本号、无墓碑、无 Merkle

## 待迭代功能

**版本与墓碑**
- 每次成功 `put` / `delete` 分配严格递增的本地 `ver`（从 1 起）
- `delete` 对已存在键：转为墓碑（`deleted: true`，保留 `ver`），`get`/`has`/`keys`/`size` 不可见；对不存在键仍返回 false 且不分配 ve
- `put` 到墓碑键：复活为存活条目并分配新 ve

**Merkle 根 `rootHash()`**
- 仅对**存活**条目建树；墓碑不进树
- 叶按 key 字典序；叶哈希：`sha256hex("L" + key + "\0" + value)`
- 内部节点：一对子节点 `sha256hex("I" + left + right)`；奇数个节点时最后一个**直接晋升**（不与自己配对）
- 空库：`sha256hex("EMPTY")`
- 相同存活内容（与插入顺序无关）必须得到相同 `rootHash`

**包含证明**
- `getProof(key) -> MerkleProof | null`：键不存在或为墓碑时返回 null
- `MerkleProof`: `{ key, value, root, path: { side: "L"|"R"; hash: string }[] }`
  - `path` 自叶向根：每一层给出**兄弟**节点的 side（兄弟在左则为 `"L"`，在右则为 `"R"`）与 hash
- `verifyProof(proof) -> boolean`：用 proof 内字段重算根，等于 `proof.root` 且与叶内容一致则为 true

**同步**
- `diffAgainst(other: MerkleKV) -> DiffOp[]`：对两边曾出现过的键（含墓碑）取 **ver 更大** 者为胜；ver 相同则 `deleted` 优先于存活；再相同则 `value` 字典序更大者胜
- `DiffOp`: `{ key: string; value: string; ver: number; deleted: boolean }` —— 表示**应写入本地**的胜者状态（含墓碑）
- 仅当本地状态与胜者不同时才产生 op；结果按 key 字典序
- `applyDiff(ops)`：按 op 写入本地（含墓碑），本地 `ver` 计数器提升到 `max(本地ver, op.ver)`；不改变 `VirtualClock`
- 双向各自 `diffAgainst` + `applyDiff` 后，两边存活视图与 `rootHash` 应一致

**墓碑 TTL / GC**
- `delete(key, opts?: { ttlMs?: number })`：`ttlMs` 缺省表示墓碑永不过期（仅能被更高 ver 的 put/diff 覆盖）
- 到期时刻 `expireAt = clock.now() + ttlMs`；`now == expireAt` 视为到期
- `tick()`：物理删除所有已到期墓碑；不影响存活键
- GC 后 `rootHash` 不变（墓碑本就不在树中），但 `diffAgainst` 不再看到被 GC 的键（除非对方仍持有）

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/hash.ts` — sha256 hex
- `src/store.ts` — 条目与 ve
- `src/tree.ts` — Merkle 构建
- `src/proof.ts` — 证明生成/校验
- `src/sync.ts` — diff / apply
- `src/kv.ts` — `MerkleKV` 门面
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
