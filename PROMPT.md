请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的无 credit 简单 FIFO 管道（enqueue / dequeue / size / peek / clear）。请在此基础上迭代实现 VirtualClock 驱动的 credit 流控、backlog、TTL reclaim、reserve/release 与 stats，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock.now()` / `advance()` 推进。

对外入口是 `CreditPipe`（见 `src/pipe.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new CreditPipe()` 无参：无界 FIFO ready 队列
- `enqueue(msg)` / `dequeue()` / `size()` / `peek()` / `clear()`
- 无 credit、无 backlog；enqueue 恒成功（返回 true）

## 待迭代功能

**构造**
- `new CreditPipe(clock: VirtualClock, peerId: string, initialCredits: number)`
  - `initialCredits >= 0`；本地 `creditsLeft()` 从此值开始
- 无参构造仅用于基础测试；feature 测试一律传入 clock + peerId

**Credits 与队列**
- `grant(n: number): void` — 增加 n 个 credit（n>0）；n<=0 抛 `CreditError`
- `creditsLeft(): number` — 当前可用 credit（已扣除 reserve）
- `enqueue(msg: string): boolean`
  - 若 `creditsLeft() > 0`：消耗 1 credit，消息进入 **ready** 队列，返回 true
  - 否则：消息进入 **backlog**（不消耗 credit），返回 false
- `dequeue(): string | undefined` — 仅从 ready 队列出队
- `size()` — **ready 队列长度**（与 base 兼容）
- `readySize()` / `backlogSize()` — feature 可观测
- `peerId(): string`

**Peer grant / reclaim / drain**
- `offerGrant(fromPeer: string, n: number, ttlMs: number): void` — 从 peer 接收 n 个带 TTL 的 credit，过期时刻 `now + ttlMs`（未使用部分可被 reclaim）
- `reclaim(): number` — 移除已过期且未使用的 credit，返回移除数量；**不**丢弃 backlog 消息
- `flushBacklog(): number` — 当 `creditsLeft() > 0` 且 backlog 非空时，按 FIFO 将 backlog 头逐条移入 ready（每条消耗 1 credit）；返回移动条数
- `grant` / `offerGrant` 后应**自动**调用 `flushBacklog`

**Overshoot / fairness**
- `reserve(n: number): boolean` — 若 `creditsLeft() >= n` 则扣除 n 并返回 true；否则 false（无部分 reserve）
- `release(n: number): void` — 归还 reserve 的 credit（n>0）；n<=0 抛 `CreditError`
- `sendWindow(): number` — 等于 `creditsLeft()`
- backlog FIFO；flushBacklog 保持顺序

**Stats**
- `stats(): { granted: number, consumed: number, reclaimed: number, rejected: number }`
  - `granted`：累计 grant + offerGrant 的 credit 总数
  - `consumed`：enqueue 成功消耗的总数
  - `reclaimed`：reclaim 累计移除数
  - `rejected`：enqueue 返回 false（进 backlog）的次数

**错误**（`src/errors.ts`）
- `CreditError`，稳定 `name` 与 message

## 模块划分

- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — `CreditStats`、`CreditBatch` 等
- `src/errors.ts`
- `src/credits.ts` — credit ledger、TTL batch、reserve
- `src/backlog.ts` — backlog FIFO
- `src/pipe.ts` — `CreditPipe` 门面
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
