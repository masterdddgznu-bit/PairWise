请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `AckWin`：主入口类
- 错误类：`AckWinError`，以及至少  
  `InvalidConfigError` / `WindowFullError` / `InvalidSeqError` / `StaleEpochError` / `ClosedError`

## 构造

```ts
new AckWin({
  clock: VirtualClock,
  windowSize: number,     // >= 1；未确认发送占用窗口
  rtoMs: number,          // >= 1；重传计时
  maxRetx: number,        // >= 0；单 seq 重传次数上限（不含首次）；超限则 fail
  recvBufSize: number,    // >= 1；接收侧乱序缓冲容量（条数）
})
```

非法 → `InvalidConfigError`。初始 `epoch = 1`，发送下一 seq = 1，接收期望 `nextDeliver = 1`，已累计确认 `cumAck = 0`。

## 语义（验收以 tests 为准）

把本类同时当作「发送端 + 接收端」的进程内链路（测试直接调用两侧 API）。

### 发送

- `send(payload: string): { seq: number; epoch: number }`  
  - 若已 `close()` → `ClosedError`。  
  - 若未确认（in-flight）条数已达 `windowSize` → `WindowFullError`。  
  - 分配 `seq`（从 1 递增），记录 payload、`sentAt=now`、`retx=0`、`rtoDeadline=now+rtoMs`，占用窗口。  
  - 返回当前 `epoch` 与 `seq`。

- `ack(epoch, cumAck: number): boolean`  
  - `epoch !== 当前 epoch` → `StaleEpochError`。  
  - `cumAck` 必须为整数且 `0 <= cumAck <= 已发送最大 seq`；`cumAck < 0` 等非法 → `InvalidSeqError`。  
  - **累计确认**：所有 `seq <= cumAck` 的 in-flight 释放窗口；若 `cumAck` 不大于已有 `cumAck`，忽略但返回 `false`；推进则 `true`。  
  - 已失败/已确认的 seq 再被覆盖确认视为幂等推进。

### 接收 / 交付

模拟对端把「收到的数据段」喂进来：

- `recv(epoch, seq, payload): 'delivered' | 'buffered' | 'duplicate' | 'dropped'`  
  - 错 epoch → `StaleEpochError`；已 close → `ClosedError`。  
  - `seq < nextDeliver` → `'duplicate'`。  
  - `seq === nextDeliver`：立即按序交付（进入交付队列），`nextDeliver++`，然后尽量从缓冲取出连续后续一并交付；返回 `'delivered'`。  
  - `seq > nextDeliver`：若缓冲已有该 seq → `'duplicate'`；若缓冲条数已达 `recvBufSize` → `'dropped'`（不覆盖旧条目）；否则入缓冲，返回 `'buffered'`。  
  - 交付队列由 `poll(): Array<{ seq, payload }>` 取出并清空（FIFO，按交付顺序）。

### 重传与失败

- `drive(): { retransmitted: number[]; failed: number[] }`  
  - 对每个仍 in-flight 且 `now >= rtoDeadline` 的 seq（按 seq 升序处理）：  
    - 若 `retx < maxRetx`：`retx++`，`rtoDeadline = now + rtoMs`，计入 `retransmitted`（表示应重发该 seq；payload 不变，可用 `payloadOf(seq)` 查）。  
    - 否则：该 seq **失败**，释放窗口，计入 `failed`，之后 `payloadOf` 仍可查历史，但不再重传。  
  - 两个数组均 seq 升序。

- `payloadOf(seq): string | undefined`：曾 send 过的 seq（含已确认/失败）可读；未知 `undefined`。

### 连接世代

- `reset(): number`：`epoch++`；清空发送 in-flight 与窗口占用；发送下一 seq 回到 1；`cumAck=0`；清空接收缓冲与交付队列；`nextDeliver=1`；**不**清除 `payloadOf` 历史也可清除——**约定：reset 后旧 seq 的 payloadOf 不再保证**（测试只查 reset 后新 seq）。返回新 epoch。  
- `close()`：之后 `send`/`recv` 抛 `ClosedError`；`ack`/`drive`/`poll` 仍可用（drive 对残留 in-flight 继续）。  
- `epoch()` / `cumAck()` / `nextDeliver()` / `inFlight(): number` / `buffered(): number`。

自行决定模块拆分；正确性以不变量与 tests 为准。
