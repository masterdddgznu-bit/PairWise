请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。退避必须按下方公式用整数运算，不得引入随机抖动。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `RetryBag`：主入口类
- `backoffMs(baseBackoffMs, backoffCapMs, attempt): number`：实现上方退避公式（供单测直接校验）
- 错误类：`RetryBagError`，以及至少  
  `InvalidConfigError` / `InvalidJobError` / `UnknownTicketError` / `FenceError`

## 构造

```ts
new RetryBag({
  clock: VirtualClock,
  leaseMs: number,          // >= 1
  maxAttempts: number,      // >= 1；attempt 从 1 起，fail 时 attempt 用尽则死信
  baseBackoffMs: number,    // >= 1
  backoffCapMs: number,     // >= baseBackoffMs
  idempotencyMs?: number,   // 默认 1000，>= 1
})
```

非法 → `InvalidConfigError`。

## 语义（验收以 tests 为准）

任务状态：`delayed | ready | running | succeeded | dead | cancelled`。

### 退避公式

当一次 `fail` 后若仍可重试，入 `delayed`，就绪时刻：

`readyAt = now + min(backoffCapMs, baseBackoffMs * 2^(attempt-1))`

其中 `attempt` 为**刚刚失败的那一次**的 attempt（即 claim 时看到的值）。用整数；`2^(attempt-1)` 对 attempt>=1；若溢出超过安全整数，仍以 `backoffCapMs` 封顶即可（测试 attempt 不大）。

### enqueue

```ts
enqueue(payload: string, opts?: {
  priority?: number;       // 默认 0；越大越优先
  delayMs?: number;        // >= 0；默认 0；初始 delayed/ready
  idempotencyKey?: string; // 非空；窗口内重复 enqueue 返回原 ticket
}): number  // ticket，全局从 1 递增
```

- `payload` 须为 string，否则 `InvalidJobError`。  
- 去重：同 `idempotencyKey` 在首次成功 enqueue 的 `now + idempotencyMs` 内再次 enqueue → 返回原 ticket（不新建）。  
- `delayMs>0` → `delayed` 且 `readyAt=now+delayMs`；否则 `ready`（`readyAt=now`）。  
- 初始 `attempt=0`（尚未 claim）；首次 claim 后变为 1。

### claim / heartbeat / complete / fail / cancel

- `claim(): { ticket; fence; attempt; payload; priority } | undefined`  
  在所有 `ready` 且 `now >= readyAt` 中选：`priority` 降序，同等则 `ticket` 升序。  
  标为 `running`，`attempt += 1`，`fence` 全局递增，`leaseDeadline=now+leaseMs`。  
  无候选 → `undefined`。

- `heartbeat(ticket, fence): boolean`：仅 running 且匹配 → 续租 `true`；fence 错 → `FenceError`；未知 ticket → `UnknownTicketError`；其它 `false`。

- `complete(ticket, fence): boolean`：匹配 running → `succeeded`，`true`；fence → `FenceError`；未知 → `UnknownTicketError`；其它 `false`。

- `fail(ticket, fence): boolean`：匹配 running：  
  - 若 `attempt < maxAttempts` → `delayed`，按公式设 `readyAt`，清除 fence/lease，`true`；  
  - 否则 → `dead`，`true`。  
  fence/未知规则同 complete。

- `cancel(ticket): boolean`：`ready`/`delayed` → `cancelled` 并 `true`；`running`/`终态` → `false`；未知 → `UnknownTicketError`。

### drive

```ts
drive(): {
  requeued: number[];   // 租约到期回到 ready 的 ticket（升序）；不清空 attempt、不视为 fail
  becameReady: number[]; // delayed 到期变为 ready 的 ticket（升序）
}
```

顺序：先处理租约到期（`running` 且 `now>=leaseDeadline` → `ready`，`readyAt=now`，旧 fence 失效）；再处理 `delayed` 且 `now>=readyAt` → `ready`。

### 查询

- `status(ticket)` / `attemptOf(ticket)` / `readyTickets(): number[]`（升序）/ `deadTickets(): number[]`（升序）  
  未知 ticket → `UnknownTicketError`。

自行决定模块拆分；正确性以不变量与 tests 为准。
