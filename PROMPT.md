## 简述

实现进程内多路公平复用器：每个 lane 有独立 FIFO；`take` 从当前轮转指针起寻找下一个「可服务」lane 取其队头，并推进指针；空或暂停的 lane 跳过。可选：lane 空闲过久经 `drive` 被自动 pause。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`FairMux`，以及错误类 `FairMuxError` 和至少 `InvalidConfigError` / `InvalidLaneError` / `UnknownLaneError` / `CapacityError` / `UnknownItemError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new FairMux({
  clock,
  maxPerLane,
  idlePauseMs?: number,
})
```

- `maxPerLane` 整数 `>= 1`（每个 lane 队列上限）。
- `idlePauseMs` 可选；若给出须整数 `>= 1`。省略表示 `drive` 不做自动 pause。
- 非法配置抛 `InvalidConfigError`。
- 初始：无 lane；轮转指针无意义直至有 lane。

`ensureLane(lane): void`

- `lane` 非空字符串，否则 `InvalidLaneError`。
- 已存在则为 no-op。
- 新 lane：空队列、`paused=false`、`lastEnqueueAt=null`、`lastServeAt=null`，追加到 **lane 环序尾**（环序 = ensure 先后；已存在的不改位置）。

`enqueue(lane, payload): { itemId: number }`

- 非法 lane 名 → `InvalidLaneError`。
- 未知 lane（未 ensure）→ `UnknownLaneError`。
- 该 lane 已 `paused` → `CapacityError`（不入队）。
- 队列长度已达 `maxPerLane` → `CapacityError`。
- 成功：全局 `itemId` 从 1 递增，入该 lane FIFO 尾；`lastEnqueueAt = now`；若该 lane 曾因空闲被自动 pause，**不会**因 enqueue 自动 resume（须手动 `resume`）。

`take(): { lane: string; itemId: number; payload: unknown } | null`

- 若没有任何 lane → `null`。
- 从**当前位置**开始，在 lane 环序上最多扫描一圈：找第一个 `!paused` 且队列非空的 lane，取其队头。
- 成功：`lastServeAt = now`，轮转指针移到该 lane 的**下一位**（环序），返回条目。
- 一圈内无可服务 → `null`，指针停在本次扫描开始时的位置（不变）。
- 初始指针：第一个被 ensure 的 lane；此后按规则推进。
- `take` **不会**自动 pause/resume。

`pause(lane): boolean` / `resume(lane): boolean`

- 未知 → `UnknownLaneError`；非法名 → `InvalidLaneError`。
- `pause`：已暂停 → `false`；否则标记 paused，`true`。
- `resume`：未暂停 → `false`；否则取消 paused，`true`（不改队列）。

`cancel(itemId): boolean`

- 未知 → `UnknownItemError`。
- 仍在某 lane 队列：移除，`true`。
- 已被 take → `false`。

`drive(): { paused: string[] }`

- 仅当配置了 `idlePauseMs`：对每个 **未 pause** 且 **队列为空** 的 lane，若存在时间锚点 `lastActivity = max(lastEnqueueAt, lastServeAt)`（二者都 null 则用 ensure 时刻 `createdAt`），且 `now >= lastActivity + idlePauseMs`，则自动 pause。
- 返回本轮新 pause 的 lane 名，按环序。
- 未配置 `idlePauseMs` → 始终 `{ paused: [] }`。
- `enqueue`/`take` 都不会自动 pause。

查询：

- `lanes(): string[]` 当前环序。
- `queueIds(lane): number[]` FIFO；未知抛错。
- `isPaused(lane): boolean` 未知抛错。
- `cursor(): string | null` 当前轮转指针指向的 lane（下一次 take 扫描起点）；无 lane → `null`。
- `size(lane): number` 未知抛错。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
