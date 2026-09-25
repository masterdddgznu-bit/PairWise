请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个内存消息 broker 任务：需要实现多分区主题、按 key 哈希或轮询路由、消费者组与再均衡、提交位点、inflight 可见性超时重投、死信队列等语义。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

模块划分：
- `src/clock.ts`：`VirtualClock`（`now` / `advance`）
- `src/message.ts`：`Message`、`Delivery` 类型
- `src/partition.ts`：单分区追加与按 offset 读取
- `src/topic.ts`：多分区、按 key 哈希或轮询 produce
- `src/offset_manager.ts`：消费者组各 topic/partition 提交位点
- `src/delivery_manager.ts`：inflight、可见性超时、重投调度；同一 offset 不可并行重复投递
- `src/dead_letter.ts`：超过最大投递次数后进入 DLQ
- `src/consumer_group.ts`：成员 join/leave、确定性再均衡（consumer id 排序后 partition i 分给 `consumers[i % n]`）
- `src/broker.ts`：对外门面 `Broker`
- `src/index.ts`：统一导出

对外 API 以 `Broker` 为准（见 `src/broker.ts`）。默认 `visibilityTimeout=10`（逻辑毫秒）、`maxDeliveries=3`。offset 从 0 起连续；`partitionEndOffset` 为下一条写入位置；`committedOffset` 为组内下次应读位置（无提交时为 0）。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
