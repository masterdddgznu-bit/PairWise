请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确后端集合 `ExactBackends`（FNV mod n 索引 sorted 列表）。请在此基础上迭代实现确定性 **Maglev** 查找表 `MaglevTable`：质数 tableSize、FNV 偏好排列、经典 Maglev 填表、assign 查表、后端变更 rebuild、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactBackends` 与 `MaglevTable`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactBackends()`
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

**质数（`prime.ts`）**

- `isPrime(n: number): boolean` — 测试锁定接受 7、11、13、17 等

**排列（`permute.ts`，测试锁定）**

- 对后端 id `B`、表大小 `M`、种子 `seed`：
  - `offset = fnv32(seed, B + ':off') % M`
  - `skip = fnv32(seed, B + ':skip') % (M-1) + 1`
  - `p[j] = (offset + j * skip) % M`（j = 0..M-1）
- `buildPermutation(backendId, tableSize, seed): number[]`

**MaglevTable（`table.ts`）**

- `new MaglevTable(tableSize: number, seed: number)` — tableSize 须为 **≥7 的质数**；否则 `MaglevError`
- 后端集合始终按 sorted id 参与建表
- 经典 Maglev 填表：未填槽位 sentinel；按 sorted 后端 round-robin，依次取各后端排列中下一可用槽，槽内存 **backend id 字符串**；backends≥1 时 M 槽全满
- `addBackend(id)` / `removeBackend(id)` — 变更集合并 **rebuild**；frozen → `MaglevError`；重复 add → `MaglevError`
- `backends(): string[]` sorted
- `assign(key: string): string | null` — 无后端 null；否则 `table()[fnv32(seed, key) % M]`
- `table(): (string | null)[]` — 查找表副本（无后端时为长度 M 的全 null）
- `rebuild(): void` — 公开重建
- `exportState()` / `static fromState(state)`
- `freeze()` — 之后 add/remove/rebuild 抛 `MaglevError`；assign/table/stats 仍可读
- `stats(): { tableSize, seed, frozen, backendCount, filled }`

**错误**
- `MaglevError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/hash.ts` — FNV-1a、`fnv32`
- `src/prime.ts` — `isPrime`
- `src/permute.ts` — `buildPermutation`
- `src/table.ts` — `MaglevTable`
- `src/exact.ts` — `ExactBackends`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
