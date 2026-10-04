## 简述

实现进程内多片段装配调度器：按 key 打开有限数量的装配窗；分片写入；齐套后进入就绪队列供取出；超时未齐套的装配经 `drive` 过期；同 key 同时只能有一个进行中的装配。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`PartWin`，以及错误类 `PartWinError` 和至少 `InvalidConfigError` / `InvalidOpenError` / `UnknownAssemblyError` / `CapacityError` / `KeyBusyError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new PartWin({
  clock,
  maxOpen?: number,
  defaultTtlMs?: number,
})
```

- `maxOpen` 默认 8、整数 `>= 1`；`defaultTtlMs` 默认 100、整数 `>= 1`。非法配置抛 `InvalidConfigError`。

`open(key, parts, opts?: { ttlMs?: number }): { assemblyId: number }`

- `key` 非空字符串；`parts` 为有限整数且 `>= 2`。否则 `InvalidOpenError`。
- `ttlMs` 若给出须为整数 `>= 1`，否则用 `defaultTtlMs`；非法 `InvalidOpenError`。
- 若已存在状态为 `open` 且同 `key` 的装配 → `KeyBusyError`（`ready` / `taken` / `expired` / `cancelled` 不占用 key）。
- 当前 `open` 状态装配数已达 `maxOpen` → `CapacityError`（`ready` 不计入容量）。
- 成功：分配全局递增 `assemblyId`（从 1），`deadline = now + ttlMs`，状态 `open`，分片槽位全空。

`put(assemblyId, partIndex, payload): { status: 'accepted' | 'completed' | 'rejected' }`

- 未知 `assemblyId` → `UnknownAssemblyError`。
- `partIndex` 须为整数且 `0 <= partIndex < parts`，否则 `rejected`（不抛错）。
- 若状态不是 `open`（含已 `ready`/`taken`/`expired`/`cancelled`）→ `rejected`。
- 若 `now >= deadline`（即使尚未 `drive`）→ 视为已不可写，`rejected`（状态仍可为 `open`，直到 `drive` 才标 `expired`；或实现上也可在 put 时直接标 `expired`，但须保证后续 `put`/`statusOf` 与 `drive` 一致：过期后不能再 `accepted`，且最终 `statusOf` 为 `expired`，且不再占 key / 不占 `maxOpen`）。
- 若该 `partIndex` **已有片段** → `rejected`（禁止覆盖）。
- 否则写入该分片 → `accepted`；若此时全部分片已齐 → 状态变 `ready`，记录 `completedAt = now`，返回 `completed`（不再占 `maxOpen` / 不再占 key）。

`take(): { assemblyId: number; key: string; parts: unknown[] } | null`

- 取出一条 `ready`：优先 `completedAt` 升序，再 `assemblyId` 升序。
- 成功后状态 `taken`，`parts` 按 `partIndex` 0..parts-1 顺序组成数组。
- 无 ready → `null`。

`cancel(assemblyId): boolean`

- 未知 → `UnknownAssemblyError`。
- 仅 `open` 可取消 → `true` 且状态 `cancelled`（释放 key 与容量）。
- 其它状态 → `false`。

`drive(): { expired: number[] }`

1. 所有仍为 `open` 且 `now >= deadline` 的装配标为 `expired`（释放 key 与容量）。
2. 返回本轮新过期的 `assemblyId` **升序**（已是 `expired` 的不要重复返回）。

查询：

- `statusOf(assemblyId): 'open' | 'ready' | 'taken' | 'expired' | 'cancelled'`，未知 → `UnknownAssemblyError`。
- `openIds(): number[]` 当前 `open`，按 id 升序。
- `readyIds(): number[]` 当前 `ready`，按 take 相同排序（`completedAt` 再 id）。
- `filledCount(assemblyId): number` 已写入分片数；未知抛错；非 `open`/`ready` 也可返回当时已写数量（taken/expired/cancelled 保留快照）。
- `missingParts(assemblyId): number[]` 尚未写入的 `partIndex` 升序；已齐套则为 `[]`；未知抛错。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
