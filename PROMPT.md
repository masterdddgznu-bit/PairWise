请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确样本袋 `SampleBag`（add / size / sorted / sum / clear）。请在此基础上迭代实现确定性 T-Digest `TDigest`：质心追加与压缩、按累积权重线性插值 quantile/cdf、同 compression merge、exportCentroids/fromCentroids 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 crypto 库。

对外入口是 `SampleBag` 与 `TDigest`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new SampleBag()`
- `add(x: number)` / `size()` / `sorted(): number[]` / `sum()` / `clear()`

## 待迭代功能

**TDigest**（简化可测版，非完整论文实现；行为以测试为准）

- `new TDigest(compression: number)` — `compression >= 20`（整数），否则 `TDError`；作为质心数量上限目标
- 质心 `{ mean: number, weight: number }[]`，按 mean 升序
- `add(x: number, w: number = 1): void`
  - `w` 必须为正数，否则 `TDError`；frozen 时 `TDError`
  - 追加新质心 `{ mean: x, weight: w }`，按 mean 排序
  - 若 `centroids.length > compression` 则调用 `compress()`
- `compress(): void` — **确定性规则（测试锁定）**：
  - 当 `centroids.length > compression` 时，反复合并相邻质心对，直到 `length <= compression`
  - 每轮选 **合并权重和最小** 的相邻对 `(i, i+1)`；平局取 **最左** 索引
  - 合并后：`mean = (m_i*w_i + m_{i+1}*w_{i+1}) / (w_i + w_{i+1})`，`weight = w_i + w_{i+1}`
- `quantile(q: number): number` — `q ∈ [0,1]`，否则 `TDError`；空 digest `TDError`
  - `q <= 0` → 最小 mean；`q >= 1` → 最大 mean
  - 否则 `target = q * totalWeight`，按累积权重 walk；到达目标质心时在 **相邻质心 mean 间线性插值**（首个质心无左侧时直接返回其 mean）
- `cdf(x: number): number` — 返回 `[0,1]`：`weight(mean < x) + 0.5 * weight(mean == x)` 再除以总 weight；空返回 0
- `merge(other: TDigest): void` — 要求相同 compression；拼接质心、按 mean 排序、合并相邻同 mean 质心后 `compress()`；frozen 或 compression 不符时 `TDError`
- `exportCentroids(): {mean, weight}[]` / `static fromCentroids(compression, centroids)`
- `count(): number` — 总 weight
- `centroidCount(): number`
- `freeze(): void` — 之后 add/merge 抛 `TDError`
- `stats(): { compression, count, centroids, frozen }`

**错误**
- `TDError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/centroid.ts` — 质心排序、相邻合并
- `src/compress.ts` — 压缩规则
- `src/digest.ts` — `TDigest`
- `src/bag.ts` — `SampleBag`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
