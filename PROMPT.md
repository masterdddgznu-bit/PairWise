请在当前 TypeScript 仓库中从零实现功能，使 `npm test` 与 `npm run build` 全部通过。

仓库初始没有 `src/`。请自行创建源码与模块划分，但必须让测试能从 `src/index.ts`（或测试里写明的路径）导入所需导出。不要修改 `tests/`，不要加外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`；时间只来自注入的 `VirtualClock`。

## 需要导出（名称需一致）

- `VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）
- `EpochGate`：主入口类
- 错误类：`EpochGateError`，以及至少  
  `InvalidConfigError` / `SealingError` / `UnknownTicketError` / `FenceError` / `InvalidEpochError`

## 构造

```ts
new EpochGate({
  clock: VirtualClock,
  maxInFlight: number,   // >= 1；同一 open 世代内同时 running 上限
  maxPending?: number,   // 默认 16，>= 1；open 世代等待队列上限
  sealDrainMs: number,   // >= 1；seal 后若仍有 running，超时则强取消剩余
})
```

非法 → `InvalidConfigError`。初始世代 `epoch = 1`，状态 `open`。

## 语义（验收以 tests 为准）

世代状态：`open | sealing | sealed`。任意时刻至多一个非 `sealed` 的「当前世代」；seal 完成后自动开启 `epoch+1` 为 `open`。

### submit / complete

```ts
submit(payload: string):
  | { status: 'running'; epoch: number; ticket: number; fence: number }
  | { status: 'pending'; epoch: number; ticket: number }
```

- 仅当**当前世代**为 `open` 可 submit；`sealing` → `SealingError`。  
- `payload` 须为 string，否则 `InvalidConfigError`（或实现为 Invalid 类；测试用 `EpochGateError` 子类即可——**约定抛 `InvalidConfigError`**）。  
- `ticket` 在当前世代内从 1 递增（新世代重新从 1）。  
- 若当前 running 数 `< maxInFlight`：立即 `running`，分配新 `fence`（全局递增），返回 running。  
- 否则入 pending FIFO；满则抛 `SealingError` 不合适——**约定抛 `InvalidConfigError`**（表示拒绝）；返回 pending（无 fence）。

- `complete(epoch, ticket, fence): boolean`  
  - 未知 ticket（该 epoch 无此 ticket）→ `UnknownTicketError`。  
  - epoch 已不存在记录 → `InvalidEpochError`。  
  - 仅 `running` 且 fence 匹配：标为 `done`，写入该世代结果列表（按 complete 顺序？**约定按 ticket 升序在 poll 时排序**），释放 in-flight 槽，并立刻从同世代 pending 队头晋升为 running（新 fence）；返回 `true`。  
  - fence 不匹配 → `FenceError`。  
  - 其它状态 → `false`。

### seal / drive

- `seal(): number`  
  - 当前必须为 `open`，否则 `SealingError`。  
  - 转为 `sealing`，记录 `sealAt = now`，返回当前 epoch。  
  - sealing 期间禁止 submit。  
  - **不清空** pending：仍等待晋升；但也不能再 submit。若 seal 时想丢弃 pending——**约定保留 pending，可继续被 complete 腾槽晋升**；若 `sealDrainMs` 到期强取消，pending 一并丢弃且不进入结果。

- `drive(): { sealed: number[]; forced: number[] }`  
  - 若当前 `sealing` 且 `runningCount===0` 且 `pendingCount===0`：将世代标 `sealed`，`sealed` 列入返回，并开启下一 epoch `open`。  
  - 若当前 `sealing` 且 `now >= sealAt + sealDrainMs`：将所有仍 `running`/`pending` 的 ticket **强取消**（不计结果），ticket 号列入 `forced`（升序），然后 `sealed` 并开启下一 epoch。  
  - 两个数组均为世代号或 ticket？**约定：`sealed` 为已封闭的 epoch 号列表；`forced` 为被强取消的 ticket 号列表（仅本轮）**。

### 查询

- `current(): { epoch: number; state: 'open'|'sealing'|'sealed' }`  
  注意：刚 seal 完成并开启下一世代时 current 为新 open。若需查旧世代用下面 API。  
- `stateOf(epoch)` / `results(epoch): Array<{ ticket: number; payload: string }>`（ticket 升序；仅 complete 的）  
  - 未知 epoch → `InvalidEpochError`。  
- `inFlight()` / `pending()`：当前非 sealed 世代的计数。  
- `status(epoch, ticket): 'pending'|'running'|'done'|'cancelled'`  

自行决定模块拆分；正确性以不变量与 tests 为准。
