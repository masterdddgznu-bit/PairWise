请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的简单双流配对缓冲 `JoinBuffer`（pushLeft / pushRight / drain 笛卡尔积）。请在此基础上迭代实现事件时间 interval join 引擎 `SpanJoin`：per-side watermark、join span、迟到侧输出、buffer GC、processing-time earlyFire，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；处理时间一律通过 `VirtualClock.now()` / `advance()` 推进。

对外入口是 `JoinBuffer` 与 `SpanJoin`（见 `src/buffer.ts` / `src/join.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new JoinBuffer()`：简单 paired buffer
- `pushLeft(id, value)` / `pushRight(id, value)`
- `drain(): { left, right }[]` — 当前 left×right 笛卡尔积后清空两侧
- `leftSize()` / `rightSize()` / `clear()`

## 待迭代功能

**构造**
- `new SpanJoin(clock: VirtualClock, spanMs: number, maxLatenessMs: number)`
- Join 条件：同 `key` 且 `|left.eventTime - right.eventTime| <= spanMs`

**事件**
- `{ id: string, key: string, eventTime: number, value: string }`
- `ingestLeft(e)` / `ingestRight(e): void`

**Watermark（per side `'L' | 'R'`）**
- ingest 后自动：`watermark(side) = max(已见 eventTime) - maxLatenessMs`（该侧尚无数据前为 `0`）
- `advanceWatermark(side, wm): void` — 单调不减，可与自动值取 max
- `watermark(side): number`

**迟到**
- ingest 时若 `eventTime < watermark(side)`（更新前），事件不进 join 状态，追加到 `lateOutput()`（按 eventTime、id 升序返回副本）
- 过晚事件不参与 join

**Join 与 emit**
- ingest 时将事件按 `key` 存入该侧状态，并尝试与对侧同 key 事件 join
- 匹配：`span` 内且两侧事件均未 GC、且 pair 未 emit
- 结果 `{ id: leftId+':'+rightId, key, left, right, eventTime: max(l.et,r.et) }`
- 同一 pair id 幂等，不重复 emit
- `results(): JoinOut[]` 按 `(eventTime, id)` 升序

**GC**
- 当 `min(wmL, wmR)` 推进时，丢弃 `eventTime < minWm - spanMs` 的缓冲事件（已不可能再 join）

**Early fire（processing time）**
- `earlyFire(procDeadline: number): void` — 当 `clock.now() >= procDeadline` 时，对缓冲中 span 内且尚未 emit 的 pair 提前 emit（不改变 watermark 语义）
- 仍保持 pair 幂等

**可观测**
- `lateOutput(): Event[]` 排序副本
- `buffered(side: 'L'|'R'): number` — 该侧缓冲事件条数

## 模块划分

- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — `Event`、`JoinOut` 等
- `src/errors.ts`
- `src/watermark.ts` — per-side watermark 跟踪
- `src/buffer.ts` — `JoinBuffer`
- `src/join.ts` — `SpanJoin`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
