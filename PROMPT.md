请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确字符串频率计数器 `ExactFreq`（add / count / size / total / topK / clear / keys）。请在此基础上迭代实现确定性 Lossy Counting 草图 `LossyCounter`：窗口宽度 w、桶号 b、带 delta 的条目表、add/prune、estimate 与 upperBound、mightFrequent、同 epsilon merge、exportEntries/fromEntries 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 Node crypto 库。

对外入口是 `ExactFreq` 与 `LossyCounter`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactFreq()`
- `add(key: string, n?: number)` 默认 1
- `count(key)` / `size()`（distinct 键数）/ `total()`（所有 count 之和）/ `clear()`
- `topK(k): {key, count}[]` — count 降序、key 升序平局
- `keys(): string[]` — 字典序

## 待迭代功能

**LossyCounter**

- `new LossyCounter(epsilon: number)` — epsilon ∈ (0, 0.5]；否则 `LossyError`
- 窗口宽度 `w = floor(1/epsilon)`（合法 epsilon 时 w ≥ 2）
- 流长度 `N`；当前桶 `b = ceil(N/w)`（N=0 时 b=0）
- 条目 Map：key → `{ f: number, delta: number }`（f 为结构内观测频率，delta 为最大误差界）
- `add(key: string): void` — N+=1；若 key 存在则 f+=1；否则插入 `{f:1, delta: b-1}`；若 `N % w === 0` 则 **prune**：删除 `f + delta <= b` 的条目
- `estimate(key: string): number` — 存在返回 f，否则 0（**不要**加 delta；上界见 `upperBound`）
- `upperBound(key: string): number` — 存在返回 f+delta，否则 0
- `mightFrequent(key: string, support: number): boolean` — support ∈ (0,1]；N>0 时当 `estimate(key)/N >= support - epsilon` 为 true
- `merge(other: LossyCounter): void` — 要求相同 epsilon；对每个 key **f 相加、delta 取 max**；N = N_a + N_b；重算 b=ceil(N/w) 并 **prune 一次**；frozen 或 epsilon 不符时 `LossyError`
- `exportEntries(): {key,f,delta}[]` — 按 key 升序 / `static fromEntries(epsilon, N, entries)`
- `countStream(): number`（=N）/ `bucket(): number` / `size()` / `freeze()` / `stats()`

**错误**
- `LossyError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/prune.ts` — 按桶号 prune
- `src/counter.ts` — `LossyCounter`
- `src/exact.ts` — `ExactFreq`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
