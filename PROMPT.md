请在当前 TypeScript 仓库上完成 **Feature 迭代**：保留已可用的精确 topic 发布/订阅基线，补齐通配订阅、事件日志回放与 ack/超时重投，使 `npm test` 与 `npm run build` 全部通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`。时间只通过 `VirtualClock` 推进。

## 基线（starter 上应已通过）

构造：`new WatchBus({ clock, capacity?, ackTimeoutMs? })`
- `capacity` 默认 `32`（`>= 1`）：日志最多保留最近 capacity 条（全局 seq 递增）。
- `ackTimeoutMs` 默认 `100`（`>= 1`）：未 ack 超过该时长则重投。

API：
- `subscribe(topic, consumerId)` / `unsubscribe(topic, consumerId)`：精确 topic；同一 consumer 可订多个 topic。
- `publish(topic, payload): number`：分配全局递增 `seq`（从 1 起），向所有**精确订阅该 topic**的 consumer 投递一份拷贝到其收件箱；返回 seq。
- `poll(consumerId): Array<{ seq, topic, payload, redelivery }>`：取出并清空该 consumer 当前收件箱（FIFO）。基线下 `redelivery` 恒为 `false`。
- `inboxSize(consumerId)`。

非法配置 → `InvalidConfigError`。

## Feature（需补齐）

1. **通配订阅** `subscribePattern(pattern, consumerId)` / `unsubscribePattern(pattern, consumerId)`
   - topic / pattern 均按 `.` 分段（空段非法 → `InvalidTopicError`）。
   - `*` 匹配恰好一段；`#` 仅允许出现在 pattern **最后一段**，匹配零段或多段。
   - 例：`order.*` 匹配 `order.created`，不匹配 `order.created.v2`；`order.#` 匹配 `order`、`order.created`、`order.a.b`。
   - `publish` 时：精确订阅 ∪ 通配匹配 的 consumer 都应收到（同一 consumer 对同一条 publish 只收一次）。

2. **日志回放** `replay(consumerId, fromSeq): number`
   - 将日志中 `seq >= fromSeq`、且该 consumer **当前**（精确或通配）订阅能匹配到的事件，按 seq 升序追加进其收件箱；`redelivery=false`。
   - 返回实际追加条数。日志超出 `capacity` 时丢最旧；对已淘汰 seq 的 replay 只回放仍在日志内的。

3. **ack / 超时重投**
   - `publish` 投递后，每条投递给某 consumer 的拷贝进入 **inflight**（按 consumer+seq），直到 `ack(consumerId, seq)`。
   - `ack`：移除 inflight；若 seq 未知或已 ack → `false`，成功 `true`。
   - `nack(consumerId, seq)`：立即再次投递该条到该 consumer 收件箱，`redelivery=true`，并重置超时起点为 `now`；成功 `true`。
   - `drive()`：凡 inflight 且 `now >= deliveredAt + ackTimeoutMs` 的项，重投（`redelivery=true`）并刷新 `deliveredAt=now`；返回本次重投条数。
   - `poll` 只清收件箱，**不清** inflight（需显式 ack）。
   - 基线测试不调用 ack/drive；接 Feature 后旧的精确 publish/poll 行为仍须成立（可自动 ack 豁免——**不要豁免**：基线测试不检查 inflight，只要 poll 内容正确即可；未 ack 不影响后续 publish）。

模块：`clock` / `types` / `errors` / `matcher` / `log` / `inbox` / `inflight` / `bus` / `index`。

不要改 `tests/`。
