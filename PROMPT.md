请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确字符串多重集 `ExactMultiSet`（add / remove / count / size / total / clear / keys）。请在此基础上迭代实现确定性 Counting Bloom Filter `CountingBloom`：FNV-1a 哈希族、k 个计数槽位置、add/remove、mightContain、estimateCount（经典 min 估计）、同参 merge（逐格 max）、exportCounters/fromCounters 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 Node crypto 库。

对外入口是 `ExactMultiSet` 与 `CountingBloom`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactMultiSet()`
- `add(key: string, n?: number)` 默认 1
- `remove(key, n?: number)` 减计数并在 0 处钳制
- `count(key)` / `size()`（count>0 的 distinct 键数）/ `total()`（所有 count 之和）/ `clear()` / `keys(): string[]`（字典序）

## 待迭代功能

**哈希（`hash.ts`，测试锁定）**

- FNV-1a 32-bit：`offset = 2166136261`，`prime = 16777619`
- `fnv1a32(key, seed)`：初态 `(offset ^ seed) >>> 0`；逐字符 `h ^= code; h = imul(h, prime)`；返回 `h >>> 0`
- `h0(x) = fnv1a32(x, seed)`；`h1(x) = fnv1a32(x, (seed ^ 0x9e3779b9) >>> 0)`
- 族函数 `h_i(x) = (h0(x) + i * h1(x)) >>> 0`（i = 0..hashes-1）
- `positionsForKey(key, width, hashes, seed)`：返回 `h_i(key) % width` 数组

**CountingBloom**

- `new CountingBloom(width: number, hashes: number, seed: number)`
  - `width` ∈ [8, 65536] 整数；`hashes` ∈ [1, 16] 整数；否则 `BloomError`
- 计数器：`Uint16Array(width)` 或 `number[]`，初值 0；`add` 时在 65535 处饱和
- `add(key: string, n: number = 1): void` — 每个位置 `+= n`（饱和）；frozen 时 `BloomError`；`n` 必须为正整数
- `remove(key: string, n: number = 1): void` — 每个位置 `= max(0, pos - n)`；frozen 时 `BloomError`；`n` 必须为正整数
- `mightContain(key: string): boolean` — 所有对应位置计数 > 0
- `estimateCount(key: string): number` — 对应位置计数的 **min**（经典 CBF 估计）
- `merge(other: CountingBloom): void` — 要求相同 width/hashes/seed；逐格取 **max**；维度或 seed 不符或 frozen 时 `BloomError`
- `exportCounters(): number[]` / `static fromCounters(width, hashes, seed, counters): CountingBloom`
- `freeze(): void` — 之后 add/remove/merge 抛 `BloomError`
- `stats(): { width, hashes, seed, frozen, nonZero }` — nonZero = 计数 > 0 的槽位数

**错误**
- `BloomError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/hash.ts` — FNV-1a 与哈希族
- `src/positions.ts` — 键到 k 个槽位
- `src/bloom.ts` — `CountingBloom`
- `src/exact.ts` — `ExactMultiSet`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
