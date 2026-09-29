请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的简单字符串集合 `KeySet`（add / remove / has / values / size）。请在此基础上迭代实现 Bloom-filter 集合对账：`BloomFilter`、`Replica` 摘要与双向 sync、XOR fingerprint 假阳性检测，以及 IBLT-lite `Sketch` 在单桶单差条件下精确恢复缺键，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 crypto 库；哈希请用 `src/hash.ts` 内 FNV-1a 实现。

对外入口是 `KeySet`、`BloomFilter`、`Sketch`、`Replica`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new KeySet()`
- `add(key)` / `remove(key) -> boolean` / `has(key)` / `values(): string[]`（字典序）/ `size()`

## 待迭代功能

**哈希 `src/hash.ts`**
- `fnv1a32(key: string, seed?: number): number` — 32-bit 无符号 FNV-1a
- `xorFingerprint(keys: string[]): number` — 所有键 FNV hash 的 XOR

**BloomFilter**
- `new BloomFilter(mBits: number, kHashes: number)` — m/k 必须 >0，否则 `BloomError`
- `add(key)` / `mightContain(key): boolean`
- `toBits(): string` — 长度 `mBits` 的 `'0'/'1'` 串（低位在前）
- `static fromBits(bits: string, k: number): BloomFilter`
- `union(other): BloomFilter` — 同 m、k 的按位 OR
- k 个位置：`fnv1a32(key, seed=i) % mBits`

**Sketch（IBLT-lite）**
- `new Sketch(buckets: number)` — buckets >0
- `add(key)` — bucket = `fnv1a32(key, 0x534b)` % buckets；桶内 XOR key-hash、count++
- `static fromKeys(keys: string[], buckets: number): Sketch`
- `diff(other, candidates?: string[]): string[]` — 每桶至多 1 键差时可解码；`count` 差 ±1 且 XOR 差为 key-hash 时，用 `candidates` 反查键名；结果字典序

**Replica**
- `new Replica(id: string, mBits?: number, kHashes?: number, sketchBuckets?: number)` — 默认 64/4/16
- `add` / `remove` / `has` / `values` / `size` — 委托 KeySet
- `summary(): Summary` — `{ bloomBits, size, xorFingerprint }` 来自本地键集
- `keysAbsentFrom(peerSummary: Summary): string[]` — 本地键中 peer bloom **肯定不在** peer 上的（`mightContain=false`），字典序
- `ingest(keys: string[]): number` — 批量 add，返回新增条数
- `fingerprintMismatch(peerSummary: Summary): boolean` — 本地 fingerprint 或 size 与 peer 摘要不一致
- `exactMissingViaSketch(peerSketch: Sketch): string[]` — 本地 sketch 相对 peer 解码出的本地独有键
- `static sync(a, b): { fromAtoB, fromBtoA, converged }` — 互换 `keysAbsentFrom` 并 ingest；`converged` 当且仅当 sync 后双方 fingerprint+size 一致

**错误**
- `BloomError`，稳定 `name`

## 模块划分

- `src/hash.ts` / `types.ts` / `errors.ts`
- `src/keyset.ts` — `KeySet`
- `src/bloom.ts` — `BloomFilter`
- `src/sketch.ts` — `Sketch`
- `src/replica.ts` — `Replica`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
