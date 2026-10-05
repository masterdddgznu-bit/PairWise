## 简述

实现进程内法定人数协调器：参与者名册、每笔事务的 prepare 选票、活动事务表与追加型决策 WAL 必须一致协作；成功变更都要落入 WAL，`fromJournal` 重放后活状态与后续 finalize/drive 行为与源实例一致。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`VoteFinal`、`VoteFinal.fromJournal`，以及错误类 `VoteFinalError` 和至少 `InvalidConfigError` / `InvalidArgError` / `CapacityError` / `StateError` / `UnknownError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new VoteFinal({
  clock,
  prepareMs,
  quorumNumer,
  quorumDenom?,
  maxTx?,
  maxParticipants?,
})
```

- `prepareMs` 整数 `>= 1`：`begin` 时 `deadline = now + prepareMs`。
- `quorumNumer` 整数 `>= 1`；`quorumDenom` 默认 `2`、整数 `>= 1`。提交所需 YES 票数为 `ceil(members * quorumNumer / quorumDenom)`（至少为 1）。
- `maxTx` 默认 `16`、整数 `>= 1`（同时处于 `open` 的事务上限）。
- `maxParticipants` 默认 `32`、整数 `>= 1`（已注册参与者上限）。
- 非法配置 → `InvalidConfigError`。

**活状态与 WAL（双真相）**

- 成功的状态变更必须追加一条 WAL 记录；失败抛错的操作不得追加。
- `journal()` 返回当前日志的只读拷贝（按追加序）。
- `VoteFinal.fromJournal(clock, opts, entries)`：用同一配置项从条目重放得到新实例；重放后注册表、事务状态/成员/截止、选票与后续 `finalize`/`drive` 行为与源实例可观测一致。
- 活状态与日志不得长期分叉。

**参与者**

- `register(participant)`：非空字符串；已注册 → `InvalidArgError`；名额满 → `CapacityError`。
- `unregister(participant)`：未注册 → `UnknownError`；若仍在任一 `open` 事务成员中 → `StateError`。
- `participants()`：当前已注册名，按**首次注册序**。

**事务与投票**

- `begin(members: string[]): { txId: number }`：`members` 非空、元素非空、无重复、且均为已注册；否则 `InvalidArgError`。`open` 事务数已达 `maxTx` → `CapacityError`。分配从 1 递增的整数 `txId`，状态 `open`，记录成员快照与 `deadline`。
- `prepare(txId, participant, vote: boolean)`：未知事务 → `UnknownError`；非成员 → `InvalidArgError`；重复投票 → `StateError`；已 `committed`/`aborted` → `StateError`；若 `now >= deadline` 且仍为 `open`（尚未 drive）→ `StateError`。成功记录该成员 YES/NO。
- `finalize(txId): "committed" | "aborted" | "pending"`：
  - 未知 → `UnknownError`；已终态 → 返回当前终态（不追加 WAL）。
  - 若 `now >= deadline` 且仍 `open` → 返回 `"pending"`（**不**因 finalize 自动中止；须 `drive` 或显式 `abort`）。
  - 若已有任一 NO → 置 `aborted` 并记 WAL，返回 `"aborted"`。
  - 若 YES 票数达到法定人数且未过期 → 置 `committed` 并记 WAL，返回 `"committed"`。
  - 否则返回 `"pending"`（不写 WAL）。
- `abort(txId)`：未知 → `UnknownError`；已终态 → `StateError`；否则置 `aborted` 并记 WAL。
- `drive(): { aborted: number[] }`：将所有 `open` 且 `now >= deadline` 的事务置 `aborted` 并记 WAL；返回被中止的 `txId` 数组（按 `txId` 升序）。

**查询**

- `status(txId)`：`"open" | "committed" | "aborted"`；未知 → `UnknownError`。
- `votes(txId)`：`{ participant: string; vote: boolean }[]`，按成员在 `begin` 时的顺序，仅含已投票者；未知事务 → `UnknownError`。
- `deadlineOf(txId)` / `membersOf(txId)`：未知 → `UnknownError`。
- `openTxIds()`：当前 `open` 的 txId 升序。

正确性以不变量与测试为准。宜拆成多模块（名册、选票、事务表、WAL 等），不指定内部文件名。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
