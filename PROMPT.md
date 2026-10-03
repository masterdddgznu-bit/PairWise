请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `ResvMesh`：主入口类
- 错误类：`ResvMeshError`，以及至少  
  `InvalidConfigError` / `UnknownHolderError` / `InvalidRequestError` / `FenceError` / `UnknownTicketError`

## 构造

```ts
new ResvMesh({
  clock: VirtualClock,
  capacity: Record<string, number>, // 每种资源容量，键非空、值整数 >= 0；至少一种资源
  leaseMs: number,                  // >= 1；持有租约时长
  waitTimeoutMs?: number,           // 默认 1000，>= 1；排队等待上限
})
```

非法配置 → `InvalidConfigError`。初始每种资源 `available === capacity`。

## 语义（验收以 tests 为准）

资源请求是 `needs: Record<string, number>`：只允许出现在 `capacity` 中的键；每个值为整数 `>= 1`；未知键或非正 → `InvalidRequestError`。

状态：持有者可对同一 `holderId` 同时拥有 **至多一个 active ticket**（`held` 或 `waiting`）。再 `reserve` → `InvalidRequestError`。

### reserve

```ts
reserve(holderId: string, needs: Record<string, number>, opts?: {
  priority?: number;   // 默认 0；越大越优先
  holdDeadlineMs?: number | null; // 非 null 时：获得持有后，到 now+holdDeadlineMs 仍未全部 release 则 drive 强释
}): ReserveResult
```

`holderId` 非空字符串。`holdDeadlineMs` 若提供须 `>= 1`，否则 `InvalidRequestError`。

返回：

- `{ status: 'granted', ticket, fence, granted: needs拷贝 }`  
  当且仅当当前 **所有** 需求资源 `available >= need`：原子扣减 available，进入 `held`，`leaseDeadline = now + leaseMs`，`fence` 从 1 起对该 holder 每次新 granted 递增（全局单调亦可，但同 ticket 内 fence 固定）。
- `{ status: 'waiting', ticket }`  
  资源不足：进入等待队列，**不**扣减 available。`waitDeadline = now + waitTimeoutMs`。
- 不返回 rejected；超时由 `drive` 处理。

`ticket`：全局递增正整数，从 1 起，每次 `reserve`（含进入 waiting）分配新 ticket。

### 等待队列唤醒顺序

当 available 因 `release` / 租约回收 / hold 截止强释 而增加后，按以下键排序尝试授予等待者（稳定）：

1. `priority` **降序**
2. 同等 priority：入队时刻（`reserve` 时的 `clock.now()`）**升序**
3. 仍同等：`ticket` **升序**

对每个等待者：若其 `needs` 此刻可完全满足，则原子授予（扣减、转 `held`、设 `leaseDeadline`、分配 **新** `fence`，清除 waitDeadline）；否则跳过该等待者继续看后续（**非**严格队头阻塞——允许插队授予后到者，若后者需求更小且可满足）。  
一轮从队头规则排序列表扫描到尾；若本轮有人被授予，再重新排序扫描，直到某轮无人可授予。

### heartbeat / release / cancelWait

- `heartbeat(holderId, ticket, fence): boolean`  
  仅 `held` 且三者匹配时续租（`leaseDeadline = now + leaseMs`）→ `true`；否则 `false`（不抛，除非 ticket 从未存在 → `UnknownTicketError`）。
- `release(holderId, ticket, fence, giving?: Record<string, number>): boolean`  
  仅 `held` 且匹配：  
  - `giving` 缺省 = 当前仍持有的全部；否则为部分释放（每种 `1..held`）。超量或未知键 → `InvalidRequestError`。  
  - 归还 available；若持有清零则 ticket 终态 `released`。  
  - 成功后尝试唤醒等待者。匹配失败 → `false`；未知 ticket → `UnknownTicketError`；fence 不匹配但 ticket 存在且 held → `FenceError`。
- `cancelWait(holderId, ticket): boolean`  
  仅 `waiting` 匹配 holder+ticket：移出队列 → `cancelled`，`true`；否则 `false`；未知 ticket → `UnknownTicketError`。

### drive

`drive(): DriveReport`，按顺序：

1. **租约到期**：`held` 且 `now >= leaseDeadline` → 归还其全部剩余资源，ticket → `expired`，然后尝试唤醒。
2. **持有截止**：`held` 且设置了 holdDeadline 且 `now >= holdDeadline` → 同上强释，ticket → `expired`（与租约到期相同终态），再唤醒。
3. **等待超时**：`waiting` 且 `now >= waitDeadline` → 移出队列，ticket → `timeout`（不授予）。

返回：

```ts
{
  expired: number[];   // 本轮因租约或 hold 截止而 expired 的 ticket，字典序（数值升序）
  timedOut: number[];  // 本轮等待超时的 ticket，数值升序
}
```

同一 ticket 不会既 expired 又 timedOut。先处理所有到期 held，再处理 waiting 超时。

### 查询

- `available(kind: string): number`（未知 kind → `InvalidRequestError`）
- `status(ticket): 'waiting'|'held'|'released'|'expired'|'timeout'|'cancelled'`（未知 → `UnknownTicketError`）
- `heldOf(holderId): { ticket, fence, remaining: Record<string,number> } | undefined`  
  仅当该 holder 当前有 `held` ticket。
- `waitingTickets(): number[]` 当前等待中 ticket 数值升序。

自行决定文件拆分与状态存放；正确性由不变量与测试约束。
