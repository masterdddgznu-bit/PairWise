请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `GroupFifo`：主入口类
- 错误类：`GroupFifoError`，以及至少  
  `InvalidConfigError` / `InvalidMessageError` / `UnknownReceiptError` / `ReceiptFenceError`

## 构造

```ts
new GroupFifo({
  clock: VirtualClock,
  visibilityMs: number,     // >= 1；receive 后默认不可见时长
  maxReceiveCount: number,  // >= 1；超过则进 DLQ（在可见性到期重回时判定）
  dedupMs?: number,         // 默认 1000，>= 1；同 group+dedupId 去重窗口
  maxReceiveBatch?: number, // 默认 10，>= 1；单次 receive 上限
})
```

非法配置 → `InvalidConfigError`。

## 语义（验收以 tests 为准）

消息属于某个 `groupId`（非空字符串）。**同一 group 同一时刻至多一条 in-flight**（已被 receive 尚未 delete/回队/进 DLQ）。不同 group 可并行 in-flight。

### send

```ts
send(groupId: string, body: string, opts?: {
  dedupId?: string;     // 非空；窗口内重复 → 返回先前 messageId，不新建
  delayMs?: number;     // >= 0；默认 0；>0 时先 delay，到期后才可被 receive
}): string  // messageId
```

- `groupId`/`body` 非法（空 groupId）→ `InvalidMessageError`。  
- `messageId` 全局递增字符串形式 `"m1"`, `"m2"`, ...  
- 去重：若提供 `dedupId`，且存在同 `groupId+dedupId` 在 `sentAt + dedupMs` 内仍被记住的记录（无论消息是否已删/进 DLQ，窗口按首次成功 send 的时间计），返回原 `messageId`。  
- `delayMs > 0`：`visibleAt = now + delayMs`；否则立即 `ready`（`visibleAt = now`）。

### receive

```ts
receive(maxn?: number): Array<{
  messageId: string;
  groupId: string;
  body: string;
  receiveCount: number;
  receipt: string;
  fence: number;
}>
```

- `maxn` 默认 1；须 `1..maxReceiveBatch`，否则 `InvalidMessageError`。  
- 选择算法（重复直到取满或没有可取）：  
  1. 只考虑状态为 `ready` 且 `now >= visibleAt` 的消息；  
  2. **跳过**其 `groupId` 已有 in-flight 的 group；  
  3. 在剩余候选中取 **入队序号最小**（`messageId` 数值序，即先 send 的优先）的一条；  
  4. 将其标为 in-flight：`receiveCount += 1`，`visibilityDeadline = now + visibilityMs`，分配新 `receipt`（`"r1"`,…）与新 `fence`（全局递增自 1）。  
- 同一次 `receive` 内已选中的 group 视为 occupied，不能再取同组下一条（FIFO 组阻塞）。

### delete / changeVisibility

- `delete(receipt, fence): boolean`  
  - 未知 receipt → `UnknownReceiptError`；  
  - fence 不匹配 → `ReceiptFenceError`；  
  - 仅当该 receipt 仍对应当前 in-flight 时删除消息成功 `true`；否则 `false`（例如已回队/已 DLQ/已被新 receive 换新 receipt）。
- `changeVisibility(receipt, fence, visibilityMs): boolean`  
  - 校验同 delete；成功则 `visibilityDeadline = now + visibilityMs`（`visibilityMs >= 0`，否则 `InvalidMessageError`）。`0` 表示立刻可在下一 `drive` 回队（见下）。

### drive

```ts
drive(): {
  requeued: string[]; // 本轮可见性到期回队的 messageId，字典序
  deadLetter: string[]; // 本轮进 DLQ 的 messageId，字典序
  delayedReady: string[]; // 本轮 delay 到期变为 ready 的 messageId，字典序
}
```

顺序：

1. **delay 到期**：`delayed` 且 `now >= visibleAt` → 变为 `ready`（计入 delayedReady）。  
2. **可见性到期**：in-flight 且 `now >= visibilityDeadline`：  
   - 若 `receiveCount >= maxReceiveCount` → 移入 DLQ（不再可 receive），计 deadLetter；  
   - 否则回队为 `ready`，`visibleAt = now`，清除 receipt（旧 receipt 失效），计 requeued。  
3. 返回三类 id，各自升序（`m#` 按数值比）。

### 查询

- `approxReady(): number` 当前可被 receive 选中的消息数（ready 且 visible 且 group 无 in-flight）— 允许 O(n) 精确计算。  
- `inflightCount(): number`  
- `dlqIds(): string[]` 字典序（数值序）  
- `peekGroup(groupId): string[]` 该组内仍在主队列（ready/delayed/in-flight）的 messageId 按入队序。

自行决定模块拆分；正确性以不变量与 tests 为准。
