请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确分桶 `ExactBuckets`（FNV mod n）。请在此基础上迭代实现确定性 **Jump Consistent Hash** `JumpHash`：FNV 种子 key→uint64、论文 jump 循环（BigInt）、动态 bucket 数 resize 语义、movedKeys、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactBuckets` 与 `JumpHash`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactBuckets(n: number)` — n 为 ≥1 整数；否则 `ExactError`
- `setNumBuckets(n: number)` / `numBuckets(): number`
- `assignExact(key: string): number` — `fnv1a32(key, 0) % numBuckets`（确定性占位精确分桶）
- `clear()` — 将 bucket 数重置为构造时的初始值

## 待迭代功能

**哈希（`hash.ts`，测试锁定）**

- FNV-1a 32-bit：`offset = 2166136261`，`prime = 16777619`
- `fnv1a32(data: string, seed = 0): number` — 初态 `(offset ^ seed) >>> 0`；逐字符 `h ^= code; h = imul(h, prime)`；返回 `h >>> 0`

**Jump 循环（`jump.ts`，测试锁定）**

```
jumpConsistentHash(key: uint64, numBuckets: int) -> int
  b = -1; j = 0
  while j < numBuckets:
    b = j
    key = key * 2862933555777941757 + 1   // uint64 算术，用 BigInt
    j = floor( (b+1) * (2^31 / ((key>>33)+1)) )
  return b
```

- 常量 `2862933555777941757n`；除数用 `(key >> 33n) + 1n`；`2^31 = 2147483648`
- key 每一步乘加后保持 uint64（`& ((1n << 64n) - 1n)`）

**JumpHash（`hasher.ts`）**

- `new JumpHash(numBuckets: number, seed: number)` — numBuckets ≥ 1 整数；否则 `JumpError`
- `keyToUint64(key: string): bigint` — `lo = fnv1a32(key, seed)`，`hi = fnv1a32(key, (seed+1)>>>0)`；返回 `(BigInt(hi)<<32n)|BigInt(lo)`
- `assign(key: string): number` — `jumpConsistentHash(keyToUint64(key), numBuckets)`
- `setNumBuckets(n: number): void` — n≥1；frozen → `JumpError`；改变 n 会 remap（除 n 与 seed 外无额外状态）
- `numBuckets()` / `seed()`
- `assignMany(keys: string[]): number[]`
- `distribution(keys: string[]): number[]` — 长度为 numBuckets 的各桶计数
- `movedKeys(keys: string[], newNumBuckets: number): string[]` — 若 numBuckets 变为 newNumBuckets 时 assign 会变的 key（字典序）；不修改 self；newNumBuckets 无效 → `JumpError`
- `exportState(): { numBuckets, seed }` / `static fromState(state)`
- `freeze()` — 之后 `setNumBuckets` 抛 `JumpError`；`assign` / `assignMany` / `distribution` / `movedKeys` / `stats` 仍可用
- `stats(): { numBuckets, seed, frozen }`

**错误**
- `JumpError`（+ `ExactError` 用于 base），稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/hash.ts` — FNV-1a
- `src/jump.ts` — `jumpConsistentHash`
- `src/hasher.ts` — `JumpHash`
- `src/exact.ts` — `ExactBuckets`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
