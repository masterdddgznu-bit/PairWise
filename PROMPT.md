## 简述

实现进程内批量键钉扎器：一个 holder 打开 batch 后可钉多个 key；封口后才能整批提交或取消；key 同时只能被一个未结束的 batch 钉住，后来者排队；超时会拆掉整个 open/sealed batch 并释放 key，再按规则晋升等待者。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`PinBatch`，以及错误类 `PinBatchError` 和至少 `InvalidConfigError` / `InvalidBatchError` / `FenceError` / `UnknownBatchError` / `InvalidPinError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new PinBatch({ clock, leaseMs, maxKeysPerBatch?: number, maxWaitersPerKey?: number })
```

- `leaseMs >= 1`；`maxKeysPerBatch` 默认 8、`>= 1`；`maxWaitersPerKey` 默认 8、`>= 1`。非法配置抛 `InvalidConfigError`。

`open(holderId): { batchId: number; fence: number }`

- `holderId` 非空，否则 `InvalidBatchError`。
- 同一 holder 不能同时拥有未结束（open/sealed）的 batch → `InvalidBatchError`。
- 成功：全局递增 `batchId`（从 1）、该 batch 的 `fence` 从 1 起（每 open 一次新 batch 用新全局 fence 也从 1 递增即可——**全局 fence 从 1 递增**）；`deadline = now + leaseMs`；状态 `open`；无 key。

`pin(holderId, batchId, fence, key): { status: 'pinned' } | { status: 'waiting'; ticket: number }`

- 未知 batch → `UnknownBatchError`。
- 非该 holder / fence 不匹配 → 若 fence 数值不对 `FenceError`，否则 `InvalidPinError`。
- batch 不是 `open` → `InvalidPinError`。
- `key` 非空；batch 内已钉过同一 key → `InvalidPinError`。
- 钉满 `maxKeysPerBatch` → `InvalidPinError`。
- key 当前未被其它活跃 batch 占用：钉入，返回 `{ status: 'pinned' }`。
- key 被占用：进入该 key 等待队列（记下 `batchId`/`holderId`/`key`）。`ticket` 全局从 1 递增。队列满 → `InvalidPinError`。同等按入队时刻升序再 ticket 升序。返回 `{ status: 'waiting'; ticket }`。
- 等待成功入队后，**不算**已钉入 batch（batch 的 keys 列表不含它）；晋升成功时再钉入。

`seal(holderId, batchId, fence): boolean`

- 未知 `UnknownBatchError`；fence 错 `FenceError`；非 holder 或非 open → `false`。
- 若 batch 仍有 **本 batch 发起的 waiting ticket** 未解决 → `InvalidBatchError`（不能带着未完成的 pin 等待去封口）。
- 成功：状态 `sealed`，续 `deadline = now + leaseMs`，`true`。

`commit(holderId, batchId, fence): boolean`

- 未知 `UnknownBatchError`；fence 错 `FenceError`。
- 仅 `sealed` 可 commit；否则 `false`。
- 成功：释放所有已钉 key（供等待者晋升），状态 `committed`，`true`。

`abort(holderId, batchId, fence): boolean`

- 未知 `UnknownBatchError`；fence 错 `FenceError`。
- `open` 或 `sealed` 可 abort；已终态 `false`。
- 成功：取消该 batch 仍在各 key 队列里的 waiting；释放已钉 key 并晋升；状态 `aborted`；`true`。

`cancelWait(holderId, ticket): boolean`

- 未知 ticket → `InvalidPinError`。
- 不属于 holder 或已不是 waiting → `false`。
- 移出队列 `true`。

`drive()`：

1. 所有仍为 `open`/`sealed` 且 `now >= deadline` 的 batch 按 abort 语义作废，状态 `timedout`。
2. 对每个刚释放或本就空闲的 key，按等待序晋升：队头对应的 batch 若仍为 `open` 且未钉满且尚未含该 key，则钉入并去掉 waiting；若 batch 已不能接收（非 open / 已满 / 已含 key / 已终态）则丢弃该 waiting（视为取消）并继续下一队头。
3. 返回 `{ timedOut: number[] }` 本轮超时的 `batchId` 升序。

查询：

- `statusOf(batchId): 'open' | 'sealed' | 'committed' | 'aborted' | 'timedout'`
- `keysOf(batchId): string[]` 已钉入 key 字典序
- `holderOfKey(key): string | undefined` 当前占用该 key 的 batch 的 holder
- `waitingTickets(key): number[]` 按晋升序
- 未知 batch 的 status/keys → `UnknownBatchError`。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
