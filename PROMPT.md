请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确字符串计数器 `CounterMap`（inc / get / set / keys / size / total）。请在此基础上迭代实现确定性 Count-Min Sketch `CountMinSketch`：FNV-1a 多行哈希、标准 add 与 conservative update、estimate 取下界、cellwise-sum merge、heavyHitters 阈值查询、exportTable/fromTable 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 crypto 库；哈希请用 `src/hash.ts` 内 FNV-1a 实现。

对外入口是 `CounterMap` 与 `CountMinSketch`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new CounterMap()`
- `inc(key, n=1)` / `get(key)` / `set(key, n)` / `keys(): string[]`（字典序）/ `size()` / `total()`

## 待迭代功能

**哈希 `src/hash.ts`**
- `fnv1a32(key: string, seed?: number): number` — 32-bit 无符号 FNV-1a

**CountMinSketch**
- `new CountMinSketch(depth: number, width: number)`
  - `depth >= 1`；`width` 为 >=2 的 2 的幂；否则 `SketchError`
- `add(key: string, count: number = 1): void` — count 必须为正整数，否则 `SketchError`
  - 标准 CM：每行 r，`idx = hash(key, seed=r) % width`；`table[r][idx] += count`
- `addConservative(key, count=1): void` — conservative update：仅对当前 depth 个单元中值等于最小值者递增（经典 CU）
- `estimate(key: string): number` — 各行对应单元取 min
- `merge(other: CountMinSketch): void` — depth/width 相同；**cellwise sum**（标准可加 CM merge）；维度不符或 frozen 时 `SketchError`
- `heavyHitters(candidates: string[], threshold: number): string[]` — 候选中 estimate >= threshold 者，字典序
- `exportTable(): number[][]` / `static fromTable(table: number[][]): CountMinSketch`
- `totalAdded(): number` — 所有 add/addConservative 传入 count 之和
- `freeze(): void` — 之后 add/addConservative/merge 抛 `SketchError`；estimate/heavyHitters/stats 仍可用
- `stats(): { depth, width, totalAdded, frozen }`

**错误**
- `SketchError`，稳定 `name`

## 模块划分

- `src/hash.ts` / `types.ts` / `errors.ts`
- `src/table.ts` — 二维计数表 clone/export
- `src/sketch.ts` — `CountMinSketch`
- `src/counter.ts` — `CounterMap`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
