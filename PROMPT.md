## 简述

实现进程内令牌桶调度器：全局桶按时间补充；请求按 key 扣令牌；令牌不足可排队或短时透支；`drive` 补充令牌后按公平序尽量发放排队请求。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`TokenBin`，以及错误类 `TokenBinError` 和至少 `InvalidConfigError` / `InvalidRequestError` / `UnknownTicketError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new TokenBin({
  clock,
  capacity,
  refillPerMs,
  maxDebt?: number,
  maxQueue?: number,
})
```

- `capacity >= 1`（桶上限，整数）；`refillPerMs >= 1`（每毫秒补充的令牌数，整数）；`maxDebt` 默认 0、`>= 0`（允许 tokens 暂为负到 `-maxDebt`）；`maxQueue` 默认 16、`>= 1`。非法配置抛 `InvalidConfigError`。
- 初始 `tokens = capacity`，`lastRefillAt = 0`。

补充规则（在 `request`/`drive`/`tokens` 前都先执行一次）：

- `elapsed = now - lastRefillAt`（`now = clock.now()`）。
- 若 `elapsed > 0`：`tokens = min(capacity, tokens + elapsed * refillPerMs)`，然后 `lastRefillAt = now`。
- 注意：`tokens` 可为负（透支）；补充时从当前（可能为负）值往上加，仍封顶 `capacity`。

`request(key, cost): { status: 'ok' } | { status: 'queued'; ticket: number } | { status: 'rejected' }`

- `key` 非空；`cost` 为有限整数且 `>= 1`。否则 `InvalidRequestError`。
- 先 refill。
- 若 `tokens - cost >= -maxDebt`：扣 `tokens -= cost`，返回 `{ status: 'ok' }`。
- 否则若当前排队总数（所有 key）`< maxQueue`：入队，`ticket` 全局从 1 递增，记录 `key/cost/enqueuedAt=now`，返回 `{ status: 'queued'; ticket }`。
- 否则 `{ status: 'rejected' }`。

排队公平序（发放与 `waitingTickets` 共用）：

1. 该 key 的 **累计已成功 ok 次数**（含即时 ok 与后来从队列发放的）更少者优先；
2. 同等则 `enqueuedAt` 升序；
3. 再同等 `ticket` 升序。

`cancel(ticket): boolean`

- 未知 ticket → `UnknownTicketError`。
- 已不在队列 → `false`。
- 移出 `true`。

`drive(): { granted: number[] }`

1. refill。
2. 按公平序反复取队头候选：若 `tokens - cost >= -maxDebt` 则扣令牌、出队、计入该 key 成功次数，`granted` 追加 ticket；否则 **停止**（不要跳过后面更小请求——严格按公平序，队头不够就停）。
3. 返回 `granted`（本轮发放的 ticket 列表，按发放顺序）。

查询：

- `tokens(): number` 先 refill 再返回当前 tokens（可为负）。
- `waitingTickets(): number[]` 当前排队按公平序。
- `successCount(key): number` 该 key 累计成功 ok 次数；未知 key（从未 request 成功或入队过）返回 0。
- `queueLength(): number`

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
