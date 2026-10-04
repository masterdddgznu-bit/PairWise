## 简述

实现进程内资源所有权移交：无主资源可被认领；持有者可发起向他人的移交（prepare → 对方 accept → 持有者 commit）；任一步失败或超时都要干净回滚；旧 fence 的操作必须被拒绝。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`OwnMove`，以及错误类 `OwnMoveError` 和至少 `InvalidConfigError` / `InvalidClaimError` / `FenceError` / `InvalidHandoffError` / `UnknownResourceError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new OwnMove({ clock, handoffTimeoutMs })
```

- `handoffTimeoutMs >= 1`，否则 `InvalidConfigError`。

资源由非空 `resourceId` 标识。

`claim(holderId, resourceId): { fence: number }`

- `holderId`/`resourceId` 非空，否则 `InvalidClaimError`。
- 资源不存在：创建并授予，`fence = 1`，状态 `owned`。
- 资源已存在且当前无主（仅在 commit 后不会出现无主；见下——实际上只有从未 claim 才不存在）：若已有 owner → `InvalidClaimError`。
- 正在 handoff 中 → `InvalidClaimError`。

`prepare(ownerId, resourceId, fence, toHolderId): { handoffId: number }`

- 未知资源 `UnknownResourceError`。
- 必须是当前 owner 且 fence 匹配，否则 fence 不匹配 `FenceError`，其它 `InvalidHandoffError`。
- `toHolderId` 非空且不等于 `ownerId`，否则 `InvalidHandoffError`。
- 已有进行中的 handoff → `InvalidHandoffError`。
- 成功：进入 `handoff`，分配全局递增 `handoffId`（从 1），`deadline = now + handoffTimeoutMs`，`accepted = false`。owner 仍是 `ownerId`，fence 不变。

`accept(toHolderId, handoffId): boolean`

- 未知 handoff → `InvalidHandoffError`。
- handoff 已结束（committed/aborted/timedout）→ `false`。
- `toHolderId` 不是目标 → `false`。
- 已 accept → `false`。
- 成功标记 accepted 并 `true`。

`commit(ownerId, resourceId, fence, handoffId): boolean`

- 未知资源 `UnknownResourceError`。
- fence 不匹配当前资源 fence → `FenceError`。
- 无进行中 handoff、或 `handoffId` 不匹配、或调用者不是当前 owner、或尚未 accept → `false`（不抛 `FenceError`）。
- 成功：owner 变为 `toHolderId`，`fence` 对该资源递增 1，清除 handoff，返回 `true`。

`abort(ownerId, resourceId, fence, handoffId): boolean`

- 未知资源 `UnknownResourceError`。
- fence 不匹配 → `FenceError`。
- 无匹配进行中 handoff 或不是 owner → `false`。
- 成功清除 handoff（无论是否已 accept），owner/fence 不变，`true`。

`drive()`：

1. 所有 `now >= deadline` 的进行中 handoff 视为超时中止（等同 abort，但不需要 owner 调用）。
2. 返回 `{ timedOut: number[] }` 本轮超时的 `handoffId` 升序。

查询：

- `ownerOf(resourceId): string | undefined` 未知资源 `UnknownResourceError`。
- `fenceOf(resourceId): number` 同上。
- `handoffOf(resourceId): { handoffId: number; toHolderId: string; accepted: boolean } | undefined` 仅进行中；未知资源 `UnknownResourceError`。
- `statusOf(handoffId): 'pending' | 'accepted' | 'committed' | 'aborted' | 'timedout'`  
  未知 handoff → `InvalidHandoffError`。`pending` 表示进行中且未 accept；`accepted` 表示进行中且已 accept。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
