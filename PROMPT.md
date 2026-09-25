请在当前 TypeScript 仓库中修复并补全 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个约六成完成的 ack 消息总线：快乐路径大多可用，但多模块之间的游标、inflight、重试与死信在边界条件下不一致。请先阅读现有实现与测试，再做最小必要修改。

模块：
- `src/store.ts`：按主题追加消息，分配从 1 递增的 offset。
- `src/subscription.ts`：订阅游标、inflight、ack/nack。
- `src/delivery.ts`：按策略拉取下一条可投递消息（含重试延迟）。
- `src/dlq.ts`：超过最大重试后的死信。
- `src/bus.ts`：门面，对外 publish / subscribe / poll / ack / nack / stats。

语义要求（以测试为准，并与模块注释对齐）：
1. 只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。
2. `publish(topic, payload)` 追加消息并返回 offset。不存在的 topic 在首次 publish 或 subscribe 时创建。
3. `subscribe(topic, consumer, opts?)`：同一 `(topic, consumer)` 重复订阅返回同一 subscription id；`opts.maxDeliver` 默认 3；`opts.redeliveryDelay` 默认 0（单位：逻辑 tick）。新订阅从「当前末尾」开始（只接收订阅之后的新消息），除非 `opts.fromOffset` 指定（含历史）。
4. `poll(subId, nowTick)`：返回当前应投递给该订阅的下一条消息（进入 inflight），若无则 `null`。同一消息在 ack/nack 前不能再次 poll 出。若已有 inflight，必须返回 `null`。若存在 redelivery pending 且 `nowTick < availableAt`，必须返回 `null`（不能跳过该 offset 去投递更新的消息）。
5. `ack(subId, offset)`：确认后推进提交游标；只允许 ack 当前 inflight 的 offset，否则抛错。游标必须连续：ack 成功后 `committed` 变为该 offset，下一条从 offset+1 考虑。
6. `nack(subId, offset, nowTick)`：投递次数 +1；若仍小于 `maxDeliver`，则重新入队并设 `availableAt = nowTick + redeliveryDelay`；若达到上限，进入 DLQ 并推进游标（视为该 offset 已消费失败落死信）。nack 非 inflight offset 抛错。
7. `stats()` 返回聚合：`topics`、`messages`、`subscriptions`、`inflight`、`dlq`。
8. 注意兼容：旧订阅对象上的字段/方法可能被其它模块调用；修改时保持 `Bus` 与各模块的约定一致。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
