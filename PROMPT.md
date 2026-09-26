请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的固定窗口限流（register / allow / remaining / unregister）。请在此基础上迭代实现 Token Bucket、周期配额、熔断、事件 Watch、原子 batchAllow、refund 与 Compact，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `RateGate`（见 `src/gate.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `register(clientId, limit, windowMs)`：注册固定窗口策略；重复 register 覆盖配置并重置计数
- `unregister(clientId)` / `clients()`（字典序）
- `allow(clientId) -> boolean`：当前窗口内未超限则放行并计数+1；窗口滚动依据 `clock.now()`
- `remaining(clientId) -> number`：当前窗口剩余额度
- 未注册客户端调用 `allow` / `remaining` 抛出 `UnknownClientError`

## 待迭代功能

**Token Bucket**
- `setTokenBucket(clientId, capacity, refillPerMs)`：将该客户端切换为令牌桶（之后 `allow`/`remaining`/`refund` 走桶语义，不再用固定窗口）
- 桶初始满额；每次判定前先按 `elapsed * refillPerMs` 补充，上限 `capacity`
- 成功 `allow` 消耗 1 个令牌；`remaining` 返回当前可用令牌的向下取整

**周期配额 Quota**
- `setQuota(clientId, max, periodMs)`：在速率限制之外再套一层周期配额
- 成功 `allow` 同时消耗 1 配额；任一闸门不足则拒绝且**两侧都不扣**
- `quotaRemaining(clientId)`；周期按 `clock.now()` 滚动重置

**熔断 Circuit**
- `setCircuit(clientId, failThreshold, cooldownMs)`
- 连续拒绝次数达到 `failThreshold` 后熔断打开：在冷却结束前调用 `allow` / `batchAllow` **抛出** `CircuitOpenError`（并记一条 `circuit_open` 事件；冷却期内重复调用也抛，但只在刚打开时记一次 open 事件——以测试为准：每次因熔断抛错都记 `circuit_open`）
- 冷却结束后自动关闭；任一成功放行将连续拒绝计数清零

**事件 Watch**
- 全局单调 `currentSeq()`；每次 `allow` 成功记 `allow`，拒绝记 `deny`，熔断抛错记 `circuit_open`
- 事件：`{ seq, type, clientId, at }`，`at = clock.now()`
- `watch(fromSeq) -> watchId`：订阅 `seq > fromSeq` 的事件；若 `fromSeq < compact watermark` 抛 `CompactedError`
- `pollWatch` / `unwatch`

**batchAllow(clientIds) -> boolean**
- **全部成功或全部失败**：先检查熔断（有打开则抛 `CircuitOpenError`，无消耗）
- 再预检所有客户端在当前时刻都能放行；若有任一不能，返回 `false` 且不消耗、不记事件
- 全部可放行则一次性消耗并各记一条 `allow` 事件

**refund(clientId, n = 1)**
- 退回速率侧额度（固定窗口：减少已用计数；令牌桶：加回令牌，不超过 capacity）以及配额（若已配置）
- 不超过各自上限；未注册抛 `UnknownClientError`

**Compact**
- `compact(beforeSeq)`：丢弃 `seq < beforeSeq` 的事件，watermark=`beforeSeq`
- 之后 `watch(fromSeq)` 当 `fromSeq < beforeSeq` 时抛 `CompactedError`

## 模块划分

- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 共享类型
- `src/errors.ts` — `UnknownClientError` / `CircuitOpenError` / `CompactedError`
- `src/window.ts` — 固定窗口（基础已实现）
- `src/tokens.ts` — Token Bucket
- `src/quota.ts` — 周期配额
- `src/circuit.ts` — 熔断
- `src/events.ts` — 事件日志与 Watch / Compact
- `src/batch.ts` — batchAllow
- `src/gate.ts` — `RateGate` 门面
- `src/index.ts` — 统一导出

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
