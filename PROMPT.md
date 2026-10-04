## 简述

实现进程内工作窃取调度器：条目挂在 owner 的排队上；worker 先领自己的队头；仅当自己排队为空且已空闲足够久，才偷其他 owner 排队中最老的一条；ack 完成，nack 或租约超时都回到 **原 owner** 排队（不是小偷的队列）。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`StealQ`，以及错误类 `StealQError` 和至少 `InvalidConfigError` / `InvalidArgError` / `UnknownItemError` / `FenceError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new StealQ({
  clock,
  stealAfterMs,
  leaseMs,
  maxInflight?: number,
})
```

- `stealAfterMs` 整数 `>= 1`；`leaseMs` 整数 `>= 1`；`maxInflight` 默认 8、整数 `>= 1`（**每个 worker** 同时 leased 上限）。
- 非法配置抛 `InvalidConfigError`。

`enqueue(owner, payload): { itemId: number }`

- `owner` 非空字符串，否则 `InvalidArgError`。
- 全局 `itemId` 从 1 递增；条目进入该 owner 的 FIFO 排队，记下 `enqueuedAt = now`。
- 若该 owner 名下曾因「本队列空」记下空闲起点，入队后清除该空闲起点。

`lease(worker): { itemId: number; fence: number; owner: string; payload: unknown } | null`

- `worker` 非空，否则 `InvalidArgError`。
- 该 worker 当前 inflight 已达 `maxInflight` → `null`（不偷也不领）。
- 若该 worker **自己作为 owner 的排队非空**：领队头，不得偷取。
- 否则（自己排队空）：
  - 若还没有空闲起点：把空闲起点设为 **本次 lease 的 now**，本轮 **不偷**，返回 `null`。
  - 若已有空闲起点且 `now < 空闲起点 + stealAfterMs`：不偷，`null`。
  - 否则：从**其他** owner 的排队中选最老条目（`enqueuedAt` 升序，再 `itemId` 升序）偷取；没有可偷则 `null`。
- 成功领取/偷取：状态 leased，`fence` 全局从 1 递增，`deadline = now + leaseMs`，记录领取者 `worker`；`owner` 仍是原 owner。

`ack(worker, itemId, fence): boolean`

- 未知 item → `UnknownItemError`。
- fence 不匹配 → `FenceError`。
- 非 leased 或领取者不是该 worker → `false`。
- 成功：状态 `done`，释放 inflight，`true`。

`nack(worker, itemId, fence): boolean`

- 未知 / fence 规则同 ack。
- 非 leased 或领取者不是该 worker → `false`。
- 成功：回到 **owner** 排队尾（新的 `enqueuedAt = now`），释放 inflight，`true`。

`drive(): { expired: number[] }`

- 所有 `now >= deadline` 的 leased 条目：按 nack 相同方式回到 owner 排队，释放 inflight。
- 返回本轮回收的 `itemId` 升序。
- `lease`/`enqueue` **不会**自动过期租约。

查询：

- `queuedIds(owner): number[]` 该 owner 排队中的 itemId，FIFO 顺序。
- `inflightIds(worker): number[]` 该 worker 当前 leased，升序。
- `ownerOf(itemId): string` 未知 → `UnknownItemError`。
- `statusOf(itemId): 'queued' | 'leased' | 'done'` 未知抛错。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
