请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `CredMux`：主入口类
- 错误类：`CredMuxError`，以及至少  
  `InvalidConfigError` / `UnknownStreamError` / `StreamClosedError` /  
  `FenceError` / `StreamLimitError` / `InvalidRequestError`

## 构造

```ts
new CredMux({
  clock: VirtualClock,
  initialCredit: number,  // >= 0
  maxCredit: number,      // >= initialCredit
  idleTimeoutMs: number,  // >= 1；无活动超时则关闭流
  maxStreams?: number,    // 默认 64，>= 1；同时 open（未 closed）流上限
  maxPending?: number,    // 默认 16，>= 1；单流等待信用的 send 队列上限
})
```

非法 → `InvalidConfigError`。

## 语义（验收以 tests 为准）

流由非空 `streamId: string` 标识。每流有 `gen`（从 1 起）、`credit`、`closed` 标志、投递队列、pending 发送队列、`lastActiveAt`。

### open / close / reset

- `open(streamId): { gen: number; credit: number }`  
  - 已存在且未 closed → `InvalidRequestError`。  
  - 已 closed 的同 id 允许重新 open：新对象语义，`gen` **在该 id 上继续 +1**（若从未 open 过则从 1）。  
  - 当前未 closed 流数已达 `maxStreams` → `StreamLimitError`。  
  - 初始 `credit = initialCredit`，`lastActiveAt = now`。

- `close(streamId, gen): boolean`  
  - 未知 → `UnknownStreamError`；错 gen → `FenceError`；已 closed → `false`。  
  - 成功：标记 closed；**丢弃** pending 与未 poll 的投递队列；credit 清 0；返回 `true`。

- `reset(streamId, gen): number`  
  - 仅未 closed；校验同 close。  
  - `gen += 1`；`credit = initialCredit`；清空 pending 与投递队列；`lastActiveAt = now`；返回新 gen。

### send / grant

- `send(streamId, gen, payload: string): SendResult`  
  - 校验流存在、未 closed、gen 匹配。  
  - `payload` 必须是 string，否则 `InvalidRequestError`。  
  - 若 `credit >= 1`：`credit--`，消息进入该流投递队列（FIFO），更新 `lastActiveAt`，返回  
    `{ status: 'sent'; seq: number; credit: number }`  
    `seq` 为该流内从 1 递增（reset/re-open 后从 1 再起）。  
  - 若 `credit === 0`：进入 pending FIFO；若 pending 已满 → `InvalidRequestError`；返回  
    `{ status: 'pending'; pending: number }`（pending 为入队后长度）。  
  - 不更新… **约定**：pending 入队也更新 `lastActiveAt`。

- `grant(streamId, gen, n: number): number`  
  - `n` 须为整数 `>= 1`，否则 `InvalidRequestError`。  
  - 校验流/gen/未 closed。  
  - `credit = min(maxCredit, credit + n)`，然后 **按 pending FIFO 尽量发送**：每条消耗 1 credit，进入投递队列并分配 seq，直到 credit 用尽或 pending 空。  
  - 更新 `lastActiveAt`；返回最终 credit。

### poll / 查询

- `poll(streamId, gen, maxn?: number): Array<{ seq: number; payload: string }>`  
  - `maxn` 默认全部；若提供须 `>= 1`。  
  - 取出并移除投递队列前缀，更新 `lastActiveAt`。  
  - 错 gen / 未知 / closed → 对应错误（closed → `StreamClosedError`）。

- `creditOf(streamId): number` / `genOf(streamId): number` / `pendingOf(streamId): number` / `queuedOf(streamId): number`（投递队列长度）  
  - 未知流 → `UnknownStreamError`；已 closed 仍可查询 gen/credit(0)/pending(0)/queued(0)。

- `openIds(): string[]` 当前未 closed 的 id，字典序。

### drive

`drive(): { idleClosed: string[] }`  

对每个未 closed 流，若 `now >= lastActiveAt + idleTimeoutMs` → 等同 `close`（用当前 gen），id 计入 `idleClosed`（字典序）。

自行决定模块拆分；正确性以不变量与 tests 为准。
