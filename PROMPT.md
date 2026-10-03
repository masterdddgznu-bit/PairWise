请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

## 目标

实现进程内 **事件时间 tumbling 窗口引擎（WaterMesh）**：按 key 聚合、watermark 关闭窗口、迟到侧输出、超 lateness 丢弃，以及 checkpoint。禁止真实网络 / DB / `setTimeout` / `Math.random`。`VirtualClock` 仅用于 checkpoint 元数据中的 `procTime` 字段（`clock.now()`），**不**自动推进 watermark。

模块文件需存在并可由 `index` 导出：`clock` / `types` / `errors` / `windows` / `watermark` / `late` / `checkpoint` / `mesh` / `index`。内部切分自定，**以不变量与 tests 为准**。

## 构造

```ts
new WaterMesh({
  clock: VirtualClock,
  windowSize: number,       // >= 1，事件时间窗口长度
  allowedLateness: number,  // >= 0，相对 watermark 的允许迟到
})
```

非法配置 → `InvalidConfigError`。初始 `watermark() === Number.NEGATIVE_INFINITY`（实现里可用 `-Infinity`）。

## 窗口

- 事件 `(key, eventTime, payload)` 落入窗口起点  
  `start = Math.floor(eventTime / windowSize) * windowSize`，区间 `[start, start + windowSize)`（左闭右开）。
- 每个 `(key, start)` 维护聚合：`count`（事件数）与 `sum`（对 `Number(payload)` 求和；非有限数按 `0`）。
- **关闭**：当 `watermark >= start + windowSize` 时，该窗口应被关闭并产生一条结果（只产生一次）。
- 已关闭窗口不再接受普通更新。

## Watermark

- `raiseWatermark(wm: number): Emit[]`：`wm` 必须有限；若 `wm < 当前 watermark` → `InvalidWatermarkError`；相等为幂等（返回 `[]`）。
- 提升后关闭所有满足 `start + windowSize <= wm` 且未关闭的窗口，返回本次新产生的结果数组。
- 排序：先 `windowStart` 升序，再 `key` 字典序。
- `Emit = { key, windowStart, windowEnd, count, sum }`。

## ingest

`ingest(key, eventTime, payload): 'ok' | 'late' | 'drop'`

- `key` 非空，`eventTime` 有限，否则 `InvalidEventError`。
- 若 `eventTime < watermark - allowedLateness` → `'drop'`（不进 late）。
- 否则若对应窗口 **已关闭** → 记入 late 缓冲，返回 `'late'`。
- 否则写入/更新窗口聚合，返回 `'ok'`。
- 注意：`eventTime < watermark` 但窗口尚未关闭（`windowEnd > watermark`）仍应 `'ok'`（乱序但未关窗）。

## 拉取

- `pollResults(): Emit[]`：取出并清空「已关闭待拉取」的结果队列（`raiseWatermark` 产生的结果先进入该队列；若调用方已通过 `raiseWatermark` 返回值拿到，仍须同时进入队列——即返回值与队列各一份？）。

**约定（避免歧义）**：`raiseWatermark` 的返回值即本次关闭结果；**同时**追加进内部 results 队列。`pollResults` 取出队列。测试不会在同一次 raise 后既断言返回值又要求 poll 再出同一批——但会分别覆盖两条路径。为简化实现：**raise 返回的同时 enqueue；poll 出队**。测试对同一批只走一种断言方式。

- `pollLate(): LateEvent[]`：取出并清空 late 缓冲。  
  `LateEvent = { key, eventTime, payload, windowStart }`，按 `(eventTime, key)` 升序稳定排序后存入（或 poll 时排序）。

## Checkpoint

- `checkpoint(): string`：JSON，须能恢复 watermark、未关闭窗口聚合、已关闭集合（防止重复 emit）、results 队列、late 缓冲。
- `restore(json: string): void`：替换当前状态；坏 JSON → `InvalidCheckpointError`。
- 可选字段 `procTime` 写入为 `clock.now()`（restore 不要求改 clock）。

## 查询

- `watermark()` / `openWindowCount()` / `closedWindowCount()`。

不要改 `tests/`；通过 `npm test` 与 `npm run build`。
