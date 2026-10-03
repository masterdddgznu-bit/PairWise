请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `CutMesh`：主入口类
- 错误类：`CutMeshError`，以及至少  
  `InvalidConfigError` / `UnknownShardError` / `UnknownKeyError` / `NotOwnerError` /  
  `InvalidMoveError` / `FenceError` / `InFlightError` / `UnknownTicketError`

## 构造

```ts
new CutMesh({
  clock: VirtualClock,
  shards: string[],          // 非空、唯一；内部按字典序固定
  dualWriteMs: number,       // >= 1；beginMove 后进入 dual 的最长窗口
  drainTimeoutMs: number,    // >= 1；进入 draining 后若仍有 inflight，超时则 abort 该 move
  leaseMs: number,           // >= 1；beginWrite 租约
})
```

非法 → `InvalidConfigError`。初始无任何 key。

## 所有权与读写（验收以 tests 为准）

每个已存在的 key 有：`owner` shard、`gen`（正整数世代，从 1 起）、`value: string`。

- `place(key, value, shard)`：仅当 key **尚不存在** 时创建，`owner=shard`，`gen=1`，`value` 写入。未知 shard → `UnknownShardError`；已存在 → `InvalidMoveError`。
- `ownerOf(key)` / `genOf(key)` / `get(key)`：未知 key → `UnknownKeyError`。`get` 返回当前权威值（见迁移期读规则）。

### 写入租约（inflight）

真正修改值必须走租约，禁止“无票 put”：

- `beginWrite(key, shard, gen): { ticket, fence }`  
  - key 必须存在；`gen` 必须等于当前 `genOf(key)`，否则 `FenceError`。  
  - `shard` 必须是**当前允许写入的 shard**（见下），否则 `NotOwnerError`。  
  - 同一 key 同时最多一个 inflight write；已有 → `InFlightError`。  
  - 若 key 正处于 `draining` 或 move 终态处理中不可新开写（见下）→ `InFlightError` 或 `InvalidMoveError`（以 tests 为准：draining 拒绝新 `beginWrite` → `InvalidMoveError`）。  
  - 返回 `ticket`（全局递增自 1）、`fence`（对该次 write 固定；可用全局递增）。  
  - `leaseDeadline = now + leaseMs`。
- `endWrite(ticket, fence, value): boolean`  
  - 匹配 ticket+fence：写入权威值（及 dual 规则下的副本），清除 inflight，`true`。  
  - fence 不匹配但 ticket 存在 → `FenceError`；未知 ticket → `UnknownTicketError`；其它不匹配 → `false`。
- `cancelWrite(ticket, fence): boolean`：匹配则丢弃 inflight 不改值；规则同 end（Fence/Unknown）。

`drive()` 会让租约到期的 inflight **自动 cancel**（不改值），并计入报告。

## 迁移状态机

对每个 key 至多一个 active move。`moveId` 全局递增自 1。

状态：`dual` → `draining` → (`cut` | `aborted`)。

- `beginMove(key, toShard): moveId`  
  - key 存在；`toShard` 已知且 **≠** 当前 owner；key 无 active move；无 inflight write。  
  - 否则相应错误：`UnknownKeyError` / `UnknownShardError` / `InvalidMoveError` / `InFlightError`。  
  - 进入 `dual`：记录 `from=owner`，`to=toShard`，`startedAt=now`，`dualDeadline=now+dualWriteMs`。  
  - **不**立刻改 owner。将 target 侧装入 `shadow = 当前 value`（双写副本起点）。

### dual 期读写规则

- **读 `get`**：仍读 source（owner）权威值。  
- **允许 `beginWrite` 的 shard**：`from` 或 `to` 均可。  
- **`endWrite` 生效**：  
  - 若写入方是 `from`：更新 owner 权威值，且 **同步** `shadow = value`。  
  - 若写入方是 `to`：只更新 `shadow`（不改 owner 权威值）。  
  - 因此 dual 期内读仍可能与 target shadow 不同——这是刻意的。

- `ackCatchup(moveId, shard)`：仅 `dual` 且 `shard===to`；表示 target 认为已追上。置 `caughtUp=true`，返回 `true`；其它情况 `false`（未知 moveId → `InvalidMoveError`）。

- `requestCut(moveId): boolean`  
  - 仅 `dual` 且 `caughtUp===true` 且 **当前无 inflight** → 进入 `draining`（`drainDeadline=now+drainTimeoutMs`），`true`。  
  - 若仍有 inflight → `InFlightError`。  
  - 未 catchup 或状态不对 → `false`（非法 moveId → `InvalidMoveError`）。

- `requestAbort(moveId): boolean`  
  - `dual` 或 `draining` 可 abort：丢弃 shadow；清除该 key 的 move；状态记 `aborted`；owner/gen/value 不变；`true`。  
  - 已终态 → `false`；未知 → `InvalidMoveError`。

### draining / cut

- `draining`：**拒绝**新的 `beginWrite`（`InvalidMoveError`）。已有 inflight 可 `endWrite`/`cancelWrite`。  
- 当 `draining` 且 inflight **清空**：立刻 `cut`：  
  - `owner = to`；`gen += 1`；`value = shadow`；清除 move（active 消失）；move 状态 `cut`。  
- `cutover(moveId)`：若已在 `draining` 且无 inflight，执行同上 cut，返回 `true`；若仍有 inflight → `InFlightError`；状态不对 → `false`。

### drive

```ts
drive(): {
  expiredWrites: number[]; // 本轮租约到期被取消的 ticket，升序
  forcedAbort: number[];   // 本轮被强制 abort 的 moveId，升序
  autoCut: number[];       // 本轮因 drain 清空而自动 cut 的 moveId，升序
}
```

顺序：

1. 取消所有 `now >= leaseDeadline` 的 inflight write（等同 cancelWrite 成功；若因此使某 `draining` 清空则立刻 auto cut）。  
2. 对 `dual` 且 `now >= dualDeadline`：  
   - 若 `caughtUp` → 进入 `draining`（设 `drainDeadline=now+drainTimeoutMs`）；若此时已无 inflight → 立刻 auto cut；  
   - 若未 `caughtUp` → **forced abort**（无论是否 inflight）。  
3. 对仍为 `draining` 的 move：若无 inflight → **auto cut**；若 `now >= drainDeadline` 且仍有 inflight → **forced abort**。  
4. 返回三类 id 列表（数值升序）。

## 查询

- `moveStatus(moveId): 'dual'|'draining'|'cut'|'aborted'`（未知 → `InvalidMoveError`）
- `activeMove(key): moveId | undefined`
- `shadowOf(key): string | undefined`：仅 active move（dual/draining）时返回 target shadow；否则 `undefined`；未知 key → `UnknownKeyError`
- `inflightTicket(key): number | undefined`

自行决定模块拆分；正确性以不变量与 tests 为准。
