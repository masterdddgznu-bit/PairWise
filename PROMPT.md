请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的单节点 KV（put / get / delete / has / keys / size）。请在此基础上迭代实现模拟集群 `HintCluster`：偏好列表、sloppy quorum 写入、hinted handoff、读修复，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock.now()` / `advance()` 推进（若需）。

对外入口是 `HintStore` 与 `HintCluster`（见 `src/store.ts` / `src/cluster.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new HintStore()` 无参：简单内存 Map
- `put(key, value)` / `get` / `delete` -> boolean / `has` / `keys()`（字典序）/ `size()`
- 无集群、无 quorum；delete 直接移除

## 待迭代功能

**构造**
- `new HintCluster(clock: VirtualClock, nodeIds: string[], n: number, r: number, w: number)`
  - `n` 为每个 key 的 preference list 长度；`r`/`w` 为读/写 quorum
  - 要求 `1 <= r,w <= n <= nodeIds.length`，否则抛 `ConfigError`
- Key 的 preference list：对 key 做稳定 hash，在 `nodeIds` 环上旋转，取前 `n` 个节点

**版本**
- `Dot = { nodeId: string, counter: number }`；LWW 比较 `(counter, nodeId)` 字典序更大者胜

**写入（sloppy quorum + hints）**
- `put(key, value, available: string[]): PutResult`
  - 遍历 preference list；对在 `available` 中的节点做 **primary** 写入（同一版本）
  - 对不在 `available` 的 preference 节点：选第一个 available 节点作 hint holder，`storeHint(holder, { target, key, value, version })`
  - **仅 primary 写入计入 W**；hints 不计入
  - `ok = (primaryWrites >= w)`；返回 `{ ok, written, hinted: { holder, target }[] }`

**暗示投递**
- `deliverHints(holder: string, target: string): number` — target 上线时，将 holder 上指向 target 的 hints 合并进 target 的 primary（LWW），返回投递条数并清除这些 hints

**读取 + 读修复**
- `get(key, available: string[]): { value: string | undefined, repaired: number }`
  - 按 preference 顺序从最多 `r` 个 available 节点读 primary
  - LWW 选胜出值；对读到的 stale 节点写回胜出值；`repaired` 为实际更新的节点数

**可观测**
- `preferenceList(key: string): string[]`
- `hintsFor(holder: string): Hint[]` — 按 `(target, key)` 字典序
- `nodeGet(nodeId, key): string | undefined` — 仅 primary，不含 hints

**错误**（`src/errors.ts`）
- `ConfigError`，稳定 `name` 与 message

## 模块划分

- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — `Dot`, `Hint`, `PutResult` 等
- `src/errors.ts`
- `src/hash.ts` — 稳定字符串 hash
- `src/ring.ts` — preference list
- `src/hintbox.ts` — hint 存储辅助
- `src/node.ts` — 单节点 primary + hint mailbox
- `src/cluster.ts` — `HintCluster` 门面
- `src/store.ts` — `HintStore`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
