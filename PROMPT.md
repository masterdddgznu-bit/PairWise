请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的到达序最新值存储（put / get / delete / has / keys / size）。请在此基础上迭代实现事件时间滚动窗口、显式 watermark、允许迟到与侧输出、事件 id 幂等，以及按 key 的 session 窗口，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；处理时间用 `VirtualClock`。

对外入口是 `LateWin`（见 `src/engine.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `put(key, value: number)` / `get` / `delete` / `has` / `keys()`（字典序）/ `size()`
- 语义：按**调用到达顺序**保留每个 key 的最新 number；与事件时间无关
- 基础阶段无 watermark / 窗口 / 侧输出

## 待迭代功能

构造：`new LateWin(clock?: VirtualClock, opts?: { allowedLateness?: number })`
- `allowedLateness` 缺省为 `0`

**事件接入 `emit(ev) -> "ok" | "late" | "duplicate"`**
- `ev: { id: string; key: string; value: number; eventTime: number }`
- 同一 `id` 第二次及以后：返回 `"duplicate"`，不改任何状态
- 否则按下文进入 tumbling 与 session 逻辑
- **不**再要求维护基础 `put` 视图与窗口一致；基础 API 可继续独立工作（测试不会把基础 put 与 emit 混用同一断言）

**显式 Watermark**
- `advanceWatermark(t: number): void`：单调不减；若 `t < 当前 watermark` 则忽略
- `watermark(): number`：初始为 `-1`

**滚动窗口（tumbling）**
- 需先 `enableTumbling(size: number)`（size > 0）；窗口区间 `[start, start+size)`，`start = floor(eventTime/size)*size`
- 每个窗口每个 key 维护 `{ sum, count }`
- 窗口关闭条件：`watermark >= windowEnd + allowedLateness`（`windowEnd = start + size`）
- 关闭后结果冻结；`tumblingResult(start)` 对未关闭窗口仍返回当前累积，对关闭窗口返回冻结值
- `closedTumbling(): number[]`：已关闭窗口 start，升序

**迟到与侧输出**
- 若事件到达时，其所属 tumbling 窗口**已经关闭**，则：
  - 不更新该 tumbling 窗口
  - 将事件追加到侧输出（到达序）
  - 返回 `"late"`
- 否则更新窗口并返回 `"ok"`（session 见下，仍可能更新 session）
- `sideOutput(): StreamEvent[]` 拷贝

**Session 窗口（按 key）**
- `enableSession(gap: number)`（gap >= 0）；与 tumbling 可同时启用
- 对每个 key：若与**该 key 当前未关闭 session** 的 `lastEventTime` 满足 `eventTime <= lastEventTime + gap` 且 `eventTime` 可早于 session 内事件（乱序），则并入同一 session：扩展 `start=min`、`end=max`、累加 sum/count，并记 `lastEventTime = max(lastEventTime, eventTime)`
- 若没有未关闭 session，或无法合并（`eventTime > lastEventTime + gap` 且现有 session 尚未关闭），则：
  - 若旧 session 仍未关闭但不合并：先保持旧 session，再开新 session（同一 key 可有多个 session，按 start 区分）
  - 合并判定：仅试图并入「尚未关闭」且 `eventTime <= session.end + gap` 的**最近**一个（按 end 最大）session；若 `eventTime < session.start` 也可并入并扩展 start（乱序早到）
- Session 关闭：`watermark >= session.end + allowedLateness`（此处 `end` 为 session 内最大 eventTime，不是 +1）
- 迟到：若事件无法并入任何未关闭 session，且该事件若归属的「本应」session 已全部关闭（即存在已关闭 session 覆盖该 eventTime 邻域，或更简单规则）：
  - **简化规则（以测试为准）**：对 session，若 `enableSession` 后，事件在 tumbling 意义下已 late（tumbling 已关）时 session 也不再接收，直接 `"late"` 进侧输出；若未 enable tumbling，则仅当所有未关闭 session 都不能合并且存在已关闭 session 满足 `eventTime <= closed.end + gap && eventTime >= closed.start - gap` 时算 late，否则开新 session
- 为降低歧义，测试中 **session 用例均同时 enableTumbling**，迟到以 tumbling 关闭为准；能 `"ok"` 的事件必须同时更新 session（按上面合并规则）
- `sessionResults(): { key; start; end; sum; count }[]`
  - 仅返回**已关闭** session；按 `key` 字典序，同 key 按 `start` 升序

**处理时间早期触发（仅 tumbling）**
- `armProcessingTrigger(windowStart: number, fireAt: number): void`
  - 当 `tick()` 且 `clock.now() >= fireAt`，若该窗口仍未关闭，把当时累积快照写入 `triggeredResults(windowStart)`；同一 windowStart 多次 arm 以最后一次为准；触发后清除该 arm
- `tick(): void`：处理所有到期 trigge
- `triggeredResults(windowStart): { key; sum; count }[] | null`：若曾触发过返回最后一次快照（key 字典序），否则 null
- 窗口正式关闭后的 `tumblingResult` 仍以关闭时状态为准（触发快照不替代关闭结果，除非关闭前未再变更）

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/watermark.ts`
- `src/idempotency.ts`
- `src/tumbling.ts`
- `src/session.ts`
- `src/side.ts`
- `src/triggers.ts`
- `src/engine.ts` — `LateWin`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
