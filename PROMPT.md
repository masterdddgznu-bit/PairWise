请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 需要导出（名称需一致）

从实现中导出：

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `TaskMesh`：主入口类
- 错误类：`TaskMeshError`，以及至少  
  `InvalidConfigError` / `DuplicateTaskError` / `UnknownTaskError` / `InvalidTaskError` / `LeaseError`

## 构造

```ts
new TaskMesh({
  clock: VirtualClock,
  leaseMs: number,          // >= 1，claim 后租约时长
  maxAttempts?: number,     // 默认 3，>= 1；fail 耗尽后任务 failed
})
```

## 语义（验收以 tests 为准）

任务状态：`pending | ready | running | succeeded | failed | cancelled`。

- `submit(id, opts?)`  
  - `opts.deps?: string[]`：依赖任务 id；依赖必须已经 `submit` 过，否则 `InvalidTaskError`。  
  - 依赖图禁止环，否则 `InvalidTaskError`。  
  - `opts.payload?: string`（默认 `""`）。  
  - `opts.deadlineMs?: number | null`：非 `null` 时截止时刻为 `now + deadlineMs`（`deadlineMs >= 1`）；到点仍未 `succeeded` 则在 `drive` 中变为 `failed`。  
  - 重复 id → `DuplicateTaskError`。  
  - 无依赖或依赖均已 `succeeded` → 初始 `ready`，否则 `pending`。

- `claim(workerId)`：在所有 `ready` 任务中选 `id` 字典序最小者，标为 `running`，记录 worker 与 `leaseDeadline = now + leaseMs`，`attempt` 从 1 起算（每次重新进入 running +1？**约定**：首次 claim 为 1，因 fail 回到 ready 再 claim 时 attempt+1；因租约超时回收再 claim 不增加 attempt）。返回 `{ id, payload, attempt }`；无可认领返回 `undefined`。

- `heartbeat(workerId, taskId)`：仅持有租约的 worker 可续租（`leaseDeadline = now + leaseMs`）；成功 `true`，否则 `false`。

- `complete(workerId, taskId)`：仅持有者；→ `succeeded`；唤醒因该依赖而就绪的任务；`true/false`。

- `fail(workerId, taskId)`：仅持有者；若 `attempt < maxAttempts` → 回 `ready` 且清空持有者；否则 → `failed`；`true/false`。

- `cancel(taskId)`：将任务及其所有尚未终态成功的后继（传递依赖）标为 `cancelled`（已 `succeeded` 不动；已 `failed`/`cancelled` 保持）。返回**本次新被取消**的 id 列表（字典序）。对 `running` 取消须立即生效（之后 complete/fail 应失败）。

- `drive()`：  
  1) 租约到期（`now >= leaseDeadline`）的 `running`：回到 `ready`（不清空 attempt，不视为 fail）；  
  2) 截止到期且仍非 `succeeded`/`failed`/`cancelled` 的任务 → `failed`；若它使其它任务永远无法就绪，不自动取消后继（后继可继续 pending，除非被显式 cancel）。  
  返回本轮因截止而 `failed` 的 id 字典序。

- 查询：`status(id)` / `readyIds()`（字典序）/ `attemptOf(id)`（未知任务抛 `UnknownTaskError`）。

自行决定如何拆分文件与状态存放；正确性由不变量与测试约束。
