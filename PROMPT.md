## 简述

实现进程内混合逻辑钟门闩：节点用 HLC 给消息打点；接收端按「因果前驱已交付」决定是否放行；未就绪的进缓冲，超时后按策略丢弃或强制放行。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`HlcGate`，以及错误类 `HlcGateError` 和至少 `InvalidConfigError` / `InvalidNodeError` / `InvalidMessageError` / `UnknownMessageError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。本题 `now()` 是物理时间源，供 HLC 与超时使用。

```ts
new HlcGate({ clock, nodeId, waitMs, onTimeout: 'drop' | 'force' })
```

- `nodeId` 非空字符串；`waitMs >= 1`；`onTimeout` 只能是 `'drop'` 或 `'force'`。非法配置抛 `InvalidConfigError`。

HLC 戳：`{ wall: number; logical: number }`。比较：`wall` 升序，同等 `logical` 升序。`happensBefore(a,b)` 当且仅当 `a.wall < b.wall || (a.wall === b.wall && a.logical < b.logical)`。

本地时钟：

- `stamp(): HlcStamp` 发送前打点：`wall = max(last.wall, clock.now())`；若 `wall == last.wall` 则 `logical = last.logical + 1`，否则 `logical = 0`；更新 last 并返回拷贝。
- `observe(remote: HlcStamp): HlcStamp` 收到远端戳后归并：`wall = max(last.wall, remote.wall, clock.now())`；若三者最大唯一来自 `remote.wall` 且 `wall === remote.wall` 且 `wall > last.wall`（即 wall 严格取自 remote 且大于旧 last.wall，同时 `remote.wall >= clock.now()` 使得 max 为 remote）——更稳妥的规则写死为：
  1. `wall = max(last.wall, remote.wall, clock.now())`
  2. 若 `wall === last.wall && wall === remote.wall` → `logical = max(last.logical, remote.logical) + 1`
  3. 若 `wall === last.wall && wall > remote.wall` → `logical = last.logical + 1`
  4. 若 `wall === remote.wall && wall > last.wall` → `logical = remote.logical + 1`
  5. 否则（wall 严格来自 `clock.now()` 且大于 last/remote）→ `logical = 0`
  更新 last 并返回拷贝。
- `nowHlc(): HlcStamp` 返回当前 last 拷贝（初始 `{ wall: 0, logical: 0 }`，在首次 stamp/observe 前）。

消息：

`publish(key, payload, deps?: string[]): { msgId: string; stamp: HlcStamp }`

- `key` 非空。`deps` 默认 `[]`，元素为已存在的 `msgId`；未知 id → `InvalidMessageError`。
- `msgId` 格式为 `` `${nodeId}:${seq}` ``，`seq` 从 1 递增。
- 先 `stamp()`，再登记消息：状态 `ready` 若所有 deps 均已 `delivered`，否则 `blocked`；`enqueuedAt = clock.now()`。
- 若创建后即 `ready`，立即进入可投递集（见 drive）。

`deliverable(): string[]` 当前所有 `ready` 且尚未 `delivered` 的 msgId，按 stamp 升序，同等按 msgId 字典序。

`deliver(msgId): unknown`

- 未知 `UnknownMessageError`。
- 非 `ready` 或已 `delivered` → `InvalidMessageError`。
- 标记 `delivered`，返回 payload；并唤醒依赖它的 blocked 消息（deps 全 delivered 则变 ready）。

`drive(): { delivered: string[]; dropped: string[] }`

1. 对所有仍 `blocked` 且 `clock.now() - enqueuedAt >= waitMs` 的消息：
   - `onTimeout === 'drop'`：状态 `dropped`，计入 `dropped`（不投递）。
   - `onTimeout === 'force'`：忽略未满足 deps，状态改 `ready`。
2. 然后按 `deliverable()` 顺序 **自动** `deliver` 全部当前 ready（含刚 force 的），`delivered` 为这些 msgId（已是 deliver 后的顺序）。
3. 因 deliver 新变 ready 的消息若同轮已在可投递集中，应在本轮一并 deliver（反复直到本轮没有新的 ready；注意 drop 的不算）。`dropped` 升序（msgId 字典序）。

查询：

- `statusOf(msgId): 'blocked' | 'ready' | 'delivered' | 'dropped'` 未知 `UnknownMessageError`。
- `stampOf(msgId): HlcStamp` 未知 `UnknownMessageError`。
- `depsOf(msgId): string[]` 原 deps 拷贝，字典序；未知 `UnknownMessageError`。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 物理时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
