请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确样本集 `ExactSamples`（add / size / sorted / quantileExact / clear）。请在此基础上迭代实现确定性 GK 草图 `GKSummary`：tuple 插入与压缩、按累积 g 的 quantile 查询、同 epsilon merge（按 value 合并 tuple 后 compress）、exportTuples/fromTuples 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 crypto 库。

对外入口是 `ExactSamples` 与 `GKSummary`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactSamples()`
- `add(x: number)` / `size()` / `sorted(): number[]` / `quantileExact(q: number)` / `clear()`

## 待迭代功能

**GKSummary**（简化可测版，非完整论文实现；行为以测试为准）

- `new GKSummary(epsilon: number)` — `epsilon` 必须在 `(0, 0.5]`，否则 `GKError`
- 内部 `{ value, g, delta }[]` 按 value 升序
- `insert(x: number): void`
  - frozen 时 `GKError`
  - 维护总观测数 `n`（`count()` 返回值）；每次 insert 后 `n += 1`
  - 空 summary 或 **新最小/最大** 值：插入 `{ value: x, g: 1, delta: 0 }`（不自动 compress）
  - 否则：在 **最后一个等于 x 的 tuple 之后** 插入 `{ value: x, g: 1, delta: max(0, floor(2*epsilon*n) - 1) }`，然后 `compress()`
- `compress(): void` — **确定性规则（测试锁定）**：
  - 从右向左扫描索引 `i = length-2 … 1`（**永不合并首/尾 tuple**）
  - 若 `g_i + g_{i+1} + delta_{i+1} < 2 * epsilon * n`，则 **merge i  into i+1**：`g_{i+1} += g_i` 并删除 tuple i
  - 其中 `n = count()`（当前总观测数）
- `quantile(q: number): number` — `q ∈ [0,1]`，否则 `GKError`；空 summary `GKError`
  - `q <= 0` → 最小 value；`q >= 1` → 最大 value
  - 否则 `target = q * n`，按 tuple 顺序累加 `g`，**首次** `cum >= target` 时返回该 tuple 的 value
- `merge(other: GKSummary): void` — 要求相同 epsilon；frozen 或 epsilon 不符时 `GKError`
  - **合并算法（测试锁定）**：将两侧 tuple 按 value 归并；同 value 时 `g` 求和、`delta` 取 max；写回 `self` 后 `compress()`
- `exportTuples(): GKTuple[]` / `static fromTuples(epsilon, tuples): GKSummary`
- `count(): number` — 总观测数 `n`（任意时刻 `sum(g_i) === n`）
- `tupleCount(): number`
- `freeze(): void` — 之后 insert/merge 抛 `GKError`
- `stats(): { epsilon, count, tuples, frozen }`

**错误**
- `GKError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/tuple.ts` — tuple 排序、按 value 归并
- `src/compress.ts` — 压缩规则
- `src/summary.ts` — `GKSummary`
- `src/exact.ts` — `ExactSamples`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
