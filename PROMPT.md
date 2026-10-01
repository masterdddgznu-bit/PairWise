请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确字符串集合 `ExactSet`（add / has / size / values / clear）。请在此基础上迭代实现确定性 **XOR-lite accum filter** `XorFilter`：FNV-1a 哈希族、三槽 XOR 累加表、build/contains、同 seed 同 m 的 merge（逐格 XOR）、exportTable/fromTable 与 freeze，使全部测试通过。

> 说明：本题为简化教学版 XOR 过滤器（XOR-lite），非完整 peeling 构造的 perfect XOR filter；允许假阳性，测试锁定 FNV 与 XOR 语义。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 Node crypto 库。

对外入口是 `ExactSet` 与 `XorFilter`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactSet()`
- `add(key: string)` / `has(key)` / `size()` / `values(): string[]`（字典序）/ `clear()`

## 待迭代功能

**哈希（`hash.ts`，测试锁定）**

- FNV-1a 32-bit：`offset = 2166136261`，`prime = 16777619`
- `fnv1a32(key, seed)`：初态 `(offset ^ seed) >>> 0`；逐字符 `h ^= code; h = imul(h, prime)`；返回 `h >>> 0`
- `hashIndex(key, slot, seed, m)`：`slot` 为 0|1|2；返回 `fnv1a32(key, (seed + slot) >>> 0) % m`
- `fingerprint(key, seed)`：`fp = fnv1a32(key, (seed + 3) >>> 0)`；若 `fp === 0` 则返回 `1`

**表工具（`table.ts`）**

- `nextPow2(n)`：最小 `>= n` 的 2 的幂
- `capacityFor(n)`：`nextPow2(max(8, 2 * n))`（测试锁定）
- `xorMergeTables(a, b)`：同长 `Uint32Array` 逐格 XOR；长度不等 `XorError`

**XorFilter**

- `new XorFilter(seed: number)`
- 内部 pending `Set<string>`；`build()` 前可 `add(key)`；已 built 后 `add` → `XorError`
- `build()`：
  - `n = pending.size`；`builtSize = n`
  - 若 `n === 0`：空过滤器（`m = 0`，空表）；`contains` 恒 false
  - 否则 `m = capacityFor(n)`；分配 `T = Uint32Array(m)` 初值 0
  - 对每个 pending key：算 `(i0,i1,i2,fp)`；执行 `T[i0]^=fp; T[i1]^=fp; T[i2]^=fp`（无 peeling）
- `contains(key)`：未 built 抛 `XorError`；空 built 返回 false；否则 `(T[i0]^T[i1]^T[i2]) === fp`
- `isBuilt()` / `size()`（= build 时 pending 大小）
- `merge(other)`：双方 built、同 seed、同 m；`T = xorMergeTables(T, other.T)`；`builtSize += other.builtSize`（仅信息）；frozen 或参数不符 → `XorError`
- `exportTable(): number[]` / `static fromTable(seed, m, table, size): XorFilter`
- `freeze()` — 之后 add/build/merge 抛 `XorError`
- `stats(): { seed, m, size, built, frozen }`

**错误**
- `XorError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/hash.ts` — FNV-1a、三槽 index、指纹
- `src/table.ts` — nextPow2、capacity、xor merge
- `src/filter.ts` — `XorFilter`
- `src/exact.ts` — `ExactSet`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
