## 简述

实现进程内发送侧滑窗：`send` 分配递增序号并占用窗口；`ack(seq)` 为累计确认，小于等于 seq 的 inflight 一并释放；`nack(seq)` 把该序号标为待重发；超时须经 `drive` 把到期 inflight 送入重发队列。`send`/`ack` 都不会偷偷做超时扫描。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`WinAck`，以及错误类 `WinAckError` 和至少 `InvalidConfigError` / `InvalidSeqError` / `WindowFullError` / `UnknownSeqError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new WinAck({
  clock,
  windowSize,
  rtoMs,
  maxRetransmit?: number,
})
```

- `windowSize` 整数 `>= 1`（同时处于 inflight 的最大序号数）。
- `rtoMs` 整数 `>= 1`（发送/重发后的超时）。
- `maxRetransmit` 默认 3、整数 `>= 0`（每个序号最多再重发多少次；超过则 `drop`）。
- 非法配置抛 `InvalidConfigError`。
- 初始：`nextSeq = 1`，`cumAck = 0`。

`send(payload): { seq: number }`

- 若当前 inflight 数（状态为 `inflight` 的条目）已达 `windowSize` → `WindowFullError`。
- 成功：分配 `seq = nextSeq`，`nextSeq += 1`；状态 `inflight`；`sentAt = now`；`retransmits = 0`；记下 payload。
- **不**从重发队列取号；重发用 `resend`/`drive`。

`ack(seq): { advanced: number }`

- `seq` 须为整数 `>= 0`，否则 `InvalidSeqError`。
- 若 `seq <= cumAck`：无变化，返回 `{ advanced: 0 }`。
- 若 `seq > cumAck`：把所有 `cumAck < s <= seq` 且仍存在的条目（inflight 或 awaiting_resend）标为 `acked` 并移出窗口占用；`cumAck = seq`；返回 `{ advanced: 新cumAck - 旧cumAck }`。
- 对尚未 `send` 过的空洞序号：仍推进 `cumAck`（允许累计确认越过未发送？**不允许**）——若 `seq >= nextSeq` → `InvalidSeqError`。
- `ack` **不会**扫描超时。

`nack(seq): boolean`

- 非法/未知（从未 send，或已 acked/dropped）→ `UnknownSeqError`（`seq` 非整数也 `InvalidSeqError`）。
- 若该 seq 状态为 `inflight`：改为 `awaiting_resend`，进入重发队列尾（若已在重发队列则不变），`true`。
- 若已是 `awaiting_resend`：`false`。

`drive(): { timedOut: number[]; dropped: number[] }`

1. 所有 `inflight` 且 `now >= sentAt + rtoMs` 的序号：
   - 若 `retransmits >= maxRetransmit`：状态 `dropped`，释放窗口占用，记入 `dropped`。
   - 否则：状态改为 `awaiting_resend`，入重发队列（若还没有），记入 `timedOut`（**不**在 drive 里自动重发）。
2. 返回 `timedOut`/`dropped` 均为升序。
3. `send`/`ack`/`nack` 都不会调用超时逻辑。

`resend(): { seq: number; payload: unknown } | null`

- 取出重发队列队头（FIFO）：将该序号重新变为 `inflight`，`sentAt = now`，`retransmits += 1`，从重发队列移除，返回 `{ seq, payload }`。
- 队列空 → `null`。
- 重发后仍占用同一窗口槽（本来就占着）。

查询：

- `cumAck(): number`
- `nextSeq(): number`
- `inflightSeqs(): number[]` 状态为 `inflight` 的序号升序。
- `awaitingSeqs(): number[]` 重发队列中的序号（队列序，非排序）。
- `statusOf(seq): 'inflight' | 'awaiting_resend' | 'acked' | 'dropped'` 未知 → `UnknownSeqError`。
- `inflightCount(): number` 仅 `inflight`（`awaiting_resend` **也占用窗口**，计入「窗口占用」但不计入 `inflightCount`）。
- `windowUsed(): number`：`inflight` + `awaiting_resend` 的数量。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
