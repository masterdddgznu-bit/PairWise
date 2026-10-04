## 简述

实现进程内嵌套资源租约器：资源组成树，节点排他持有；不能越过他人占着的祖先去占子节点；冲突排队；到期或释放会级联回收后代，并按规则晋升等待者。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`NestLease`，以及错误类 `NestLeaseError` 和至少 `InvalidConfigError` / `UnknownNodeError` / `InvalidAcquireError` / `InvalidReleaseError` / `FenceError` / `UnknownTicketError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new NestLease({ clock, leaseMs, maxWaitersPerNode?: number })
```

- `leaseMs >= 1`；`maxWaitersPerNode` 默认 8、`>= 1`。非法配置抛 `InvalidConfigError`。

资源树：

- `register(nodeId, parentId: string | null): void`  
  `nodeId` 非空且唯一；`parentId === null` 为根；非空父节点必须已注册。禁止成环。否则 `InvalidAcquireError`（未知父节点用 `UnknownNodeError`）。
- `parentOf(nodeId): string | null`；未知节点 `UnknownNodeError`。
- `childrenOf(nodeId): string[]` 字典序。

租约：

- 同一 `(holderId, nodeId)` 同时至多一笔持有或等待。
- `acquire(holderId, nodeId, opts?: { priority?: number })`  
  返回 `{ status: 'granted'; fence: number } | { status: 'waiting'; ticket: number }`。  
  `holderId`/`nodeId` 非空。未知节点 `UnknownNodeError`。  
  若任一代祖先正被 **其他 holder** 持有 → `InvalidAcquireError`（不能越过他人的祖先锁；祖先全空闲或均由自己持有则允许，不必先占父节点）。  
  已持有同一节点 → `InvalidAcquireError`。  
  已在该节点等待 → `InvalidAcquireError`。  
  节点空闲：授予，`fence` 对该节点全局递增（从 1 起），`leaseDeadline = now + leaseMs`。  
  节点被他人持有：进入该节点等待队列。`priority` 默认 0、越大越优先；同等 priority 按入队时刻升序，再按 `ticket` 升序。队列已满 → `InvalidAcquireError`。  
  `ticket` 全局从 1 递增（仅等待成功入队时分配）。
- `heartbeat(holderId, nodeId, fence): boolean`  
  匹配的持有则续租（`leaseDeadline = now + leaseMs`）并 `true`；fence 不匹配 `FenceError`；未持有该节点 `false`。
- `release(holderId, nodeId, fence): boolean`  
  匹配持有才能释放。若该 holder **仍持有该节点的任意直接或间接后代** → `InvalidReleaseError`（必须先放下代）。  
  fence 错 `FenceError`。释放后尝试晋升该节点等待者。匹配失败（根本没持有）`false`。
- `cancelWait(holderId, ticket): boolean`  
  未知 ticket `UnknownTicketError`；ticket 不属于该 holder 或已不是 waiting → `false`；成功移出队列 `true`。

`drive()`：

1. 所有 `now >= leaseDeadline` 的持有到期。到期节点及其 **该 holder 仍持有的全部后代** 一并回收（后代不算 fail 排队，直接丢掉持有；等待队列仍留在各节点上）。  
2. 无论本轮有无到期，drive 结束前对 **整棵树按前序、兄弟字典序** 尝试晋升空闲节点上的等待者。  
3. 晋升规则：按等待序反复取；仅当节点空闲且该等待者 **此刻没有被他人占住的祖先** 才授予（新 fence、新 deadline）；不合法的等待者 **留在队列里**（不自动取消）。  
4. 返回 `{ expired: string[] }`：本轮因到期被回收的节点 id 字典序（含级联后代）。

查询：

- `holderOf(nodeId): string | undefined` 当前持有者（无则 `undefined`）。
- `fenceOf(nodeId): number | undefined`。
- `waitingTickets(nodeId): number[]` 当前等待 ticket 按晋升序。
- `heldBy(holderId): string[]` 该 holder 当前持有节点，字典序。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
