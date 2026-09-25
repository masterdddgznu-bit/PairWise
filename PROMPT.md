请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的 Transactional Outbox / Inbox 半成品。简单 `commitWrite` + `tick` 投递通常正常；当你把「同 key 严格有序、可见性超时回收、失败退避、inbox 去重、crash/recover」组合在一起时，会出现不一致。请从 outbox 状态机与 per-key 门闩/inbox 键出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `OutboxEngine`（见 `src/engine.ts`）。核心约定：

**commitWrite**
- 在一次提交中同时写入 `domain[key]=value` 并追加 outbox 行（pending）
- 若 `messageId` 已存在于 outbox，整次提交 no-op（不更新 domain、不插入第二行）

**Relay / 投递**
- `tick()` 驱动：可见性回收 → 按 append 顺序挑选可投递 pending → 标记 in_flight（带 visibilityDeadline）→ 投递到 bus → 成功则 published
- 对 bus/handler 失败：保持 in_flight，待 `clock.now() >= visibilityDeadline` 回收为 pending，并按 `retryBackoff` 设置 `nextAttemptAt`
- 投递 pending 时须满足 `nextAttemptAt` 已到期（若有）
- at-least-once 到 bus；消费侧通过 inbox 做到 effect exactly-once

**Per-key 顺序**
- 同一 `key`：不得投递 offset 更大的消息，直到更小 offset 的消息均为 **published**
- 不同 key 可并行

**可见性超时**
- in_flight 在 `clock.now() >= visibilityDeadline` 时回收为 pending（含相等边界）

**Inbox**
- 去重键为 `(consumerId, messageId)`；不同 consumer 互不影响
- 同一 consumer 重复投递不得再次追加 effect

**crash / recover**
- `crash()` 清空 relay 易失状态；**保留** outbox、inbox、domain、effects
- `recover()` 回收已超时 in_flight，不得丢失 pending，不得导致已应用 effect 重复追加

默认：`visibilityTimeout=10`，`retryBackoff=[5,10,20]`（逻辑毫秒）。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — OutboxMessage、状态类型
- `src/domain_store.ts` — 领域 KV
- `src/outbox_store.ts` — outbox 追加与状态迁移
- `src/inbox_store.ts` — 消费去重
- `src/ordering.ts` — per-key 门闩
- `src/retry.ts` — 退避
- `src/bus.ts` — 内存 fanout
- `src/relay.ts` — poll/deliver/tick
- `src/consumer.ts` — 订阅与 effect 账本
- `src/engine.ts` — `OutboxEngine`
- `src/index.ts` — 统一导出

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
