请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确字符串集合 `ExactSet`（add / has / size / values / jaccardExact / clear）。请在此基础上迭代实现确定性 MinHash 签名草图 `MinHash`：k 路 FNV 哈希族、签名更新、Jaccard 估计、merge、exportSignature/fromSignature、similarityBand（经典 LSH 分带）与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 Node crypto 库。

对外入口是 `ExactSet` 与 `MinHash`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactSet()`
- `add(s: string)` / `has(s)` / `size()` / `values(): string[]`（字典序）/ `jaccardExact(other)` / `clear()`
- Jaccard = |A∩B| / |A∪B|；双方空 → 1；恰一方空 → 0

## 待迭代功能

**哈希（`hash.ts`，测试锁定）**

- FNV-1a 32-bit：`offset = 2166136261`，`prime = 16777619`
- `fnv1a32(key, seed)`：初态 `(offset ^ seed) >>> 0`；逐字符 `h ^= code; h = imul(h, prime)`；返回 `h >>> 0`
- `h0(x) = fnv1a32(x, seed)`；`h1(x) = fnv1a32(x, (seed ^ 0x9e3779b9) >>> 0)`
- 族函数 `h_i(x) = (h0(x) + i * h1(x)) >>> 0`（i = 0..k-1）

**MinHash**

- `new MinHash(k: number, seed: number)` — k 必须为 [1, 256] 整数，否则 `MinHashError`
- 内部签名 `Uint32Array(k)`，初值全 `0xFFFFFFFF`
- `add(s: string): void` — 对每个 i：`sig[i] = min(sig[i], h_i(s))`；frozen 时 `MinHashError`
- `estimateJaccard(other: MinHash): number` — 要求相同 k 与 seed；返回相等槽位数 / k；双方均未填充（全 `0xFFFFFFFF`）→ 1；参数不符 `MinHashError`
- `merge(other: MinHash): void` — 相同 k/seed；逐槽取 min；frozen 或参数不符 `MinHashError`
- `exportSignature(): number[]` / `static fromSignature(k, seed, sig: number[]): MinHash`
- `similarityBand(other, bands, rows): boolean` — 要求 k === bands * rows 且参数一致；将签名切成 bands 段，每段 rows 槽；任一带完全相同则 true
- `freeze(): void` — 之后 add/merge 抛 `MinHashError`
- `stats(): { k, seed, frozen, filled }` — filled = 槽位 != `0xFFFFFFFF` 的个数

**错误**
- `MinHashError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/hash.ts` — FNV-1a 与哈希族
- `src/signature.ts` — 空签名、更新、合并、填充计数
- `src/minhash.ts` — `MinHash`
- `src/exact.ts` — `ExactSet`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
