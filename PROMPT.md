请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确字符串袋 `ExactBag`（add / size / values / sampleExact / clear）。请在此基础上迭代实现确定性 Reservoir Sampling `Reservoir`：自实现 LCG 随机数、Algorithm R 蓄水池、merge（重放 other.items 经 add）、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactBag` 与 `Reservoir`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactBag()`
- `add(item: string)` — 多重集，可重复
- `size()` — 元素总数
- `values(): string[]` — 所有元素按字典序排序
- `sampleExact(k, seed): string[]` — 对排序后的 values 做 Fisher-Yates（LCG 种子），取前 k（size<k 时返回全部 values，不洗牌）
- `clear()`

## 待迭代功能

**LCG（`rng.ts`，测试锁定）**

- 线性同余：`a = 1664525`，`c = 1013904223`，`m = 2^32`
- `LcgRng(seed)`：初态 `state = seed >>> 0`
- `next(): number` — `state = (state * a + c) >>> 0`；返回新 state
- `nextFloat(): number` — `next() / 4294967296`，区间 `[0, 1)`
- `getState(): number` / `static fromState(state): LcgRng`

**采样（`sample.ts`，测试锁定）**

- `fisherYatesSample(items: string[], seed: number): string[]` — 复制 items，自尾向前 Fisher-Yates（每次 `j = floor(rng.nextFloat() * (i+1))` 交换），返回洗牌后数组

**Reservoir（Algorithm R 简化，测试锁定）**

- `new Reservoir(k: number, seed: number)` — k 为正整数 ≥ 1；否则 `ReservoirError`
- 内部：长度 ≤ k 的 `items: string[]` 槽数组；`seen` 为已观测流长度；`LcgRng` 实例
- `add(item: string): void` — frozen 时 `ReservoirError`；若 `seen < k` 则 push；否则 `r = rng.nextFloat()`，若 `r < k/seen` 则 `idx = floor(rng.nextFloat() * k)` 替换 `items[idx]`；最后 `seen++`
- `items(): string[]` — 当前槽内容，**插入顺序/槽位顺序**，不排序
- `seen(): number` / `capacity(): number`（= k）
- `merge(other: Reservoir): void` — 要求相同 k；frozen 或 k 不符时 `ReservoirError`；**仅**按顺序对 `other.items()` 中每个元素调用 `this.add(item)`（不调整 unseen mass）
- `exportState(): { k, seed, seen, items, rngState }` / `static fromState(state): Reservoir`
- `freeze(): void` — 之后 add/merge 抛 `ReservoirError`
- `stats(): { k, seed, seen, frozen, fill }` — fill = items.length

**错误**
- `ReservoirError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/rng.ts` — `LcgRng`
- `src/sample.ts` — `fisherYatesSample`
- `src/reservoir.ts` — `Reservoir`
- `src/exact.ts` — `ExactBag`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
