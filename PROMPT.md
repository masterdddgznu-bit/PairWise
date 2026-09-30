请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的简单字符串集合 `KeyBag`（add / remove / has / values / size）。请在此基础上迭代实现确定性 Cuckoo filter `CuckooFilter`：FNV-1a 指纹、双桶 xor 定位、空槽放置或 kick 重定位、lookup/remove、loadFactor/size、高负载 kick 上限失败且**事务性回滚**、exportBuckets/fromExport，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 crypto 库；哈希请用 `src/hash.ts` 内 FNV-1a 实现。

对外入口是 `KeyBag` 与 `CuckooFilter`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new KeyBag()`
- `add(key)` / `remove(key) -> boolean` / `has(key)` / `values(): string[]`（字典序）/ `size()`

## 待迭代功能

**哈希 `src/hash.ts`**
- `fnv1a32(key: string, seed?: number): number` — 32-bit 无符号 FNV-1a

**CuckooFilter**
- `new CuckooFilter(bucketCount: number, bucketSize: number, fingerprintBits: number, maxKicks: number)`
  - `bucketCount` 必须为 >=2 的 2 的幂；`bucketSize >= 1`；`fingerprintBits` 在 8..16；`maxKicks >= 1`；否则 `FilterError`
- 指纹：取 `hash(key)` 高位 masked 到 `fingerprintBits`；**永不为 0**（若为 0 则用 1）
- 双桶：`i1 = hash(key) % bucketCount`，`i2 = i1 xor hash(fingerprint) % bucketCount`（经典 xor 备选桶）
- `insert(key: string): boolean` — 在 i1/i2 空槽放置；否则沿备选路径 kick 受害者至多 `maxKicks` 次；失败时**整次 insert 事务回滚**（表状态不变）并返回 false；已成功则 true；已存在键可 idempotent 返回 true
- `lookup(key: string): boolean`
- `remove(key: string): boolean` — 从 i1 或 i2 移除一个匹配指纹；不存在返回 false
- `loadFactor(): number` — occupied / (bucketCount * bucketSize)
- `size(): number` — 已占用槽位数
- `exportBuckets(): number[][]` — 每桶指纹列表（0=空），长度 `bucketSize`
- `stats(): { inserts, insertFails, deletes, kicks }`
- `static fromExport(buckets: number[][], opts): CuckooFilter` — 从导出重建（opts 含 bucketCount/bucketSize/fingerprintBits/maxKicks）

**错误**
- `FilterError`，稳定 `name`

## 模块划分

- `src/hash.ts` / `types.ts` / `errors.ts`
- `src/fingerprint.ts` — 指纹计算
- `src/table.ts` — 桶表存储与 clone
- `src/filter.ts` — `CuckooFilter`
- `src/keybag.ts` — `KeyBag`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
