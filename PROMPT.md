请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的 FIFO 工作队列（enqueue / dequeue / ack / size）。请在此基础上迭代实现优先级、延迟投递、可见性超时与 nack、死信队列、事件 Watch、批量 dequeue 与 Compact，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `WorkQueue`（见 `src/queue.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `enqueue(payload) -> messageId`：入队；返回单调递增 id（字符串）
- `dequeue() -> Message | null`：取出最早入队且可见的消息；取出后进入 in-flight，**基础实现无限占用直到 ack**
- `ack(messageId) -> boolean`：确认并移除；未知或不在 in-flight 返回 false
- `size() -> number`：等待中（未投递 / 未 in-flight）的条数
- `Message`: `{ id, payload, priority, attempts, enqueuedAt }`

## 待迭代功能

**Priority**
- `enqueue(payload, opts?: { priority?: number; delayMs?: number })`
- 更高 `priority` 先出（默认 0）；同优先级按入队顺序（稳定）

**Delay**
- `delayMs`：消息在 `clock.now() + delayMs` 之前不可 dequeue
- `tick()`：仅用于推进内部调度检查（可见性归还 / 延迟到期）；不改变 clock（clock 由测试 `advance`）

**Visibility + nack**
- `setVisibilityTimeout(ms)`：dequeue 后若在超时前未 ack/nack，则自动归还等待队列，`attempts++`
- `nack(messageId) -> boolean`：立即归还；`attempts++`；未知返回 false
- `tick()` 应归还已超时的 in-flight

**DLQ**
- `setMaxAttempts(n)`：当归还后 `attempts >= n` 时进入死信，不再被 `dequeue` 取到
- `deadLetters() -> Message[]`：按进入 DLQ 顺序
- `redrive(messageId) -> boolean`：从 DLQ 放回等待队列（attempts 清零）；未知返回 false

**Watch**
- 全局单调 `currentSeq()`；事件 `{ seq, type, messageId, at }`
- `type`: `enqueue` | `dequeue` | `ack` | `nack` | `expire` | `dead` | `redrive`
- `watch(fromSeq) -> watchId`；`fromSeq < compact watermark` 抛 `CompactedError`
- `pollWatch` / `unwatch`

**batchDequeue(n) -> Message[]**
- 一次取最多 n 条（按优先级规则）；不足则返回能取到的
- 每条都进入 in-flight 并记 `dequeue` 事件

**Compact**
- `compact(beforeSeq)`：丢弃 `seq < beforeSeq` 事件，watermark=`beforeSeq`
- 之后 `watch(fromSeq)` 当 `fromSeq < beforeSeq` 抛 `CompactedError`

## 模块划分

- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 共享类型
- `src/errors.ts` — `CompactedError`
- `src/ids.ts` — 消息 id 生成
- `src/waiting.ts` — 等待队列（优先级/延迟）
- `src/inflight.ts` — in-flight 与可见性
- `src/dlq.ts` — 死信
- `src/events.ts` — 事件与 Watch / Compact
- `src/queue.ts` — `WorkQueue` 门面
- `src/index.ts` — 统一导出

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
