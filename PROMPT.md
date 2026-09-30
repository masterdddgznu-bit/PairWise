请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的简单倒计时 `Barrier`（arrive / remaining / parties）。请在此基础上迭代实现分布式 epoch barrier `EpochBarrier`：成员 propose/ack（或 `advance`）推进本地 epoch、全员 `epoch >= E` 时释放 wait、join/leave 伴随 fence 递增、VirtualClock 超时、stale fence/epoch 拒绝，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过注入的 `VirtualClock` 推进。

对外入口是 `Barrier` 与 `EpochBarrier`（见 `src/barrier.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new Barrier(n: number)` — n 方同步
- `arrive(): number` — 到达后返回剩余人数；减到 0 时重置为 n 并返回 0
- `remaining(): number` / `parties(): number`

## 待迭代功能

**VirtualClock**（`src/clock.ts`）
- `now(): number` / `advance(ms: number): void`

**EpochBarrier**
- `new EpochBarrier(clock: VirtualClock, members: string[])` — 初始成员各 `epoch=0`；重复 id 抛 `BarrierError`
- 成员集合 M；每节点 `epoch[node]` 从 0 起
- `propose(nodeId: string, nextEpoch: number): void` — `nextEpoch` 必须恰好为 `epochOf(nodeId)+1`；非成员抛 `BarrierError`
- `ack(nodeId: string, epoch: number): void` — 确认进入 epoch；`epoch` 必须等于已 propose 值或（无 propose 时）`current+1`；更新 `epoch[node]=max(current, epoch)` 约束下为精确 ack 值
- `advance(nodeId: string, fence: number): number` — 带 fence 的原子 +1 推进；fence 必须等于当前 `fence` 否则 `StaleFenceError`；返回新 epoch
- 屏障 epoch E 在 **所有** 成员 `epoch[m] >= E` 时释放
- `wait(epoch: number): 'pending' | 'ready' | 'timedout'`
  - 全员 `>= epoch` → `ready`
  - 否则若该 epoch 注册了 deadline 且 `clock.now() >= deadline` → `timedout`
  - 否则 `pending`
- `waitUntil(epoch: number, deadlineMs: number): void` — 注册绝对 deadline = `clock.now() + deadlineMs`
- `tick(): void` — 重新评估超时（与 `wait` 配合）
- `join(nodeId: string, atEpoch: number): void` — 仅当 `atEpoch === minEpoch()` 允许加入；新成员从 `atEpoch` 起；`fence++`
- `leave(nodeId: string): void` — 移除成员；`fence++`；可能因剩余成员已全部达标而 unblock wait
- `minEpoch(): number` / `epochOf(nodeId: string): number` / `members(): string[]`（字典序）
- 公开只读 `fence: number` — 每次 membership 变更递增
- 错误：`BarrierError`、`StaleFenceError`（稳定 `name`）

## 模块划分

- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — `WaitStatus` 等
- `src/errors.ts`
- `src/membership.ts` — 成员 epoch 表与 fence
- `src/epochs.ts` — wait deadline 注册
- `src/barrier.ts` — `Barrier` + `EpochBarrier`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
