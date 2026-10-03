请在当前 TypeScript 仓库上完成 **Feature 迭代**：保留已可用的翻滚窗口基线，补齐会话窗口与事件时间水位相关能力，使 `npm test` 与 `npm run build` 全部通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`。`VirtualClock` 表示**处理时间**（用于驱动 watermark 推进的辅助）；事件自带 `eventTime`。

## 已有基线（应继续保持）

`mode: "tumbling"` + `sizeMs`：
- `ingest(key, eventTime, value)` 把 value 累加进 `floor(eventTime/sizeMs)` 对应窗口；
- 窗口输出：`{ key, start, end, sum }`，其中 `end = start + sizeMs`；
- `flushReady(watermark)`：所有 `end <= watermark` 的窗口按 `(end, key)` 升序发射并移除；
- 多 key 隔离。

## 需要补齐的 Feature

1. **`mode: "session"` + `gapMs`**  
   同一 key 上，若新事件与当前会话最后事件的 `eventTime` 之差 `<= gapMs`，并入会话；否则关闭旧会话（`start=首事件时间`，`end=末事件时间+gapMs`？**否**：`end = lastEventTime` 的会话半开语义以 tests 为准——见下）并开启新会话。  
   **以 tests 为准的会话闭包**：会话 `start` = 该会话第一个事件的 eventTime；`end` = 最后一个事件的 eventTime + `gapMs`。当 `watermark >= end` 时该会话可被 `flushReady` 发射。

2. **Watermark**  
   - `observe(eventTime)`：内部候选水位 `maxEventTime - allowedLatenessMs`（`allowedLatenessMs` 默认 0）；  
   - `watermark()` 返回当前水位，必须**单调不减**；  
   - `ingest` 须先 `observe(eventTime)`。

3. **迟到事件**  
   - 若 `eventTime < watermark()`：不进入窗口，记入 `lateEvents()`（`{ key, eventTime, value }` 按到达顺序），并返回；  
   - `lateEvents()` 只读副本；`clearLate()` 清空。

4. **快照**  
   - `exportState()` / `importState(state)`：恢复后 watermark、未关闭窗口/会话、迟到列表与随后 `flushReady` 行为一致。

## API 轮廓

```ts
new SessWin({
  clock: VirtualClock,
  mode: "tumbling" | "session",
  sizeMs?: number,              // tumbling 必需 >=1
  gapMs?: number,               // session 必需 >=1
  allowedLatenessMs?: number,   // >=0，默认 0
})
ingest(key, eventTime, value): void
observe(eventTime): void        // 也可被 ingest 内部调用
watermark(): number             // 初始 -Infinity 用 Number.NEGATIVE_INFINITY
flushReady(): WindowOut[]       // 用当前 watermark 关闭窗口
lateEvents(): LateEvent[]
clearLate(): void
exportState(): object
importState(state: object): void
```

模块（需存在）：`clock` / `types` / `errors` / `watermark` / `tumbling` / `session` / `latebuf` / `store` / `sesswin` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
