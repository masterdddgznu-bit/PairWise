请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确字符串计数器 `ExactCounter`（add / get / size / total / clear / keys）。请在此基础上迭代实现确定性 Count Sketch `CountSketch`：FNV-1a 行哈希与符号、update、median estimate、同参 merge、exportTable/fromTable 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 Node crypto 库。

对外入口是 `ExactCounter` 与 `CountSketch`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactCounter()`
- `add(key: string, delta?: number)` 默认 +1
- `get(key)` / `size()`（非零 distinct 键数）/ `total()`（**所有键 count 之和**，可负）/ `clear()` / `keys(): string[]`（字典序）

## 待迭代功能

**哈希（`hash.ts`，测试锁定）**

- FNV-1a 32-bit：`offset = 2166136261`，`prime = 16777619`
- `fnv1a32(key, seed)`：初态 `(offset ^ seed) >>> 0`；逐字符 `h ^= code; h = imul(h, prime)`；返回 `h >>> 0`
- 行 r（0-based）：
  - `rowSeed0 = (seed + imul(r, 0x85ebca6b)) >>> 0`
  - `rowSeed1 = (seed ^ 0x9e3779b9 ^ imul(r, 0xc2b2ae35)) >>> 0`
  - `h0 = fnv1a32(key, rowSeed0)`；`h1 = fnv1a32(key, rowSeed1)`
  - `bucket = h0 % width`；`sign = (h1 & 1) === 0 ? +1 : -1`

**CountSketch**

- `new CountSketch(depth: number, width: number, seed: number)`
  - `depth` 为 [1,16] 整数；`width` 为 [2,4096] 整数（2 的幂优先但任意合法整数均可）；否则 `SketchError`
- 内部 `number[][]`：`depth` 行 × `width` 列，初值 0
- `update(key: string, delta: number = 1): void` — 每行 `table[r][bucket] += sign * delta`；frozen 时 `SketchError`
- `estimate(key: string): number` — 每行取 `sign * table[r][bucket]`；返回**中位数**
  - 奇数 depth：排序后中间值
  - 偶数 depth：排序后两个中间值的算术平均（浮点）
- `merge(other: CountSketch): void` — 要求相同 depth/width/seed；逐格相加；维度或 seed 不符或 frozen 时 `SketchError`
- `exportTable(): number[][]` / `static fromTable(depth, width, seed, table): CountSketch`
- `freeze(): void` — 之后 update/merge 抛 `SketchError`
- `stats(): { depth, width, seed, frozen, nonZero }` — nonZero = 非零格计数

**错误**
- `SketchError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/hash.ts` — FNV-1a 与行 bucket/sign
- `src/table.ts` — 二维表 clone/export/nonZero
- `src/sketch.ts` — `CountSketch`
- `src/exact.ts` — `ExactCounter`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
