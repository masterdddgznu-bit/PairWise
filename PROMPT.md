请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确字符串去重计数器 `ExactDistinct`（add / has / size / values / clear）。请在此基础上迭代实现确定性 Theta Sketch 草图 `ThetaSketch`：uint32 哈希阈值 theta、容量 k 压缩、estimate = retained/theta、同参数 merge、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactDistinct` 与 `ThetaSketch`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactDistinct()`
- `add(key: string)` / `has(key)` / `size()` / `values(): string[]`（字典序）/ `clear()`

## 待迭代功能

**哈希（`hash.ts`，测试锁定）**

- FNV-1a 32-bit：`offset = 2166136261`，`prime = 16777619`
- `fnv1a32(key, seed)`：初态 `(offset ^ seed) >>> 0`；逐字符 `h ^= code; h = imul(h, prime)`；返回 `h >>> 0`
- `hashKey(key, seed) = fnv1a32(key, seed)`

**ThetaSketch**

- `new ThetaSketch(k: number, seed: number)` — k ∈ [2, 4096] 整数；否则 `ThetaError`
- 内部：升序唯一 uint32 哈希数组；`theta: number` 为 uint32 阈值，初值 `2**32`（4294967296，表示接受全部）；哈希 ∈ [0, 2^32-1]
- `add(key)`: h = hashKey(key)；若 `h >= theta` 跳过；否则插入唯一；若 `size > k`：升序排序，保留前 k 个，设 `theta = kept[k-1] + 1`（若 `kept[k-1] === 0xFFFFFFFF` 则 theta 保持 `2**32` 且全部保留）
- `estimate(): number` = `retained * (2**32) / theta`（经典 |S|/p，p = theta/2^32）
- `thetaValue(): number` / `retained(): number`
- `merge(other)`: 要求相同 k 与 seed；`theta = min(ta, tb)`；合并哈希并过滤 `< theta`；若 `size > k` 则压缩；frozen 或参数不符 → `ThetaError`
- `exportState()` / `static fromState(state)`
- `freeze()` / `stats()`

**压缩（`compact.ts`）**

- `compactSketch(hashes: number[], k: number): { hashes: number[]; theta: number }` — 升序保留前 k；theta 规则同上

**错误**
- `ThetaError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/hash.ts` — FNV-1a 与 hashKey
- `src/compact.ts` — compactSketch
- `src/sketch.ts` — `ThetaSketch`
- `src/exact.ts` — `ExactDistinct`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
