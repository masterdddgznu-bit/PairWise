请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的事件时间窗口流处理半成品。简单顺序 ingest + tick 通常正常；当你把「窗口边界、watermark/allowedLateness、迟到侧输出、checkpoint 恢复与 exactly-once 重放」组合在一起时，会出现不一致。请从数据流/状态流出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进（watermark 基于事件时间，而非处理时间）。

对外入口是 `StreamJob`（见 `src/job.ts`）。核心约定：

**窗口语义（tumbling event-time）**
- `windowStart = floor(eventTime / windowSize) * windowSize`
- `windowEnd = windowStart + windowSize`
- 记录归属区间 `[windowStart, windowEnd)`（左闭右开）
- watermark `W = max(0, maxObservedEventTime - allowedLateness)`（基于已 ingest 记录的事件时间最大值）
- 当 `watermark >= windowEnd` 时关闭该窗口并 emit 结果
- 已关闭窗口上的迟到事件进入侧输出 `late()`，不得再更新该窗口聚合
- 未关闭窗口内，只要窗口未 close，允许 eventTime 小于当前 watermark 的事件（乱序）

**API**
- `ingest(records)`：追加源记录，返回从 0 递增的 source offset
- `tick()`：根据已观察事件时间推进 watermark 并关闭到期窗口
- `results()`：已关闭窗口 `{ key, windowStart, windowEnd, sum }[]`，稳定排序（先 key 升序，再 windowStart 升序）
- `late()`：迟到侧输出副本
- `checkpoint()` / `restore()`：保存/恢复 keyed 窗口状态、watermark、已 emit 结果、source offset；restore 后不得重复 emit 已关闭窗口
- `ingestFrom(records, startOffset)`：从 **exclusive** `startOffset` 之后重放（offset > startOffset），用于 exactly-once 恢复测试

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 记录、窗口、checkpoint 类型
- `src/watermark.ts` — `WatermarkTracker`
- `src/window_assigner.ts` — tumbling 窗口分配
- `src/keyed_state.ts` — 每 key 窗口聚合与 closed 标记
- `src/late_buffer.ts` / `src/side_output.ts` — 迟到事件
- `src/checkpoint.ts` — 序列化/恢复
- `src/operator.ts` — `WindowAggregateOperator`
- `src/job.ts` — `StreamJob` 门面
- `src/index.ts` — 统一导出

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
