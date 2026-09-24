请在当前 TypeScript 仓库中补全 `src/raft_node.ts`，使 `npm test` 与 `npm run build` 全部通过。

目标：实现一个进程内的 Raft 节点 `RaftNode`。没有真实网络，测试会直接调用 `requestVote` / `appendEntries` / `installSnapshot`。持久化状态放在传入的 `persist` 对象里，崩溃后用同一对象恢复。

必须满足：
1. 只允许修改 `src/`；禁止修改 `tests/`。
2. 选举：`tick(ms)` 累计静默时间，达到 `electionTimeoutMs` 后自增 `currentTerm`、给自己投票并成为 candidate。若 `peerIds` 为空，自己即多数派，应立刻成为 leader。收到更高 term 必须退回 follower 并更新任期。投票只在对方日志至少和自己一样新时授予，且同一任期最多投一票。
3. 日志：`appendEntries` 按 Raft 规则检查 `prevLogIndex/prevLogTerm`。冲突时截断本节点该位置之后的日志再追加；`success=false` 时尽量给出 `conflictIndex`（第一个与 leader 不一致的下标，最小为 1；若前缀缺失则为本地最后一条的下一个下标）。索引从 1 开始，快照之前的前缀视为已包含。
4. 提交：leader 只能通过**当前任期**的日志推进 `commitIndex`。旧任期日志要等到本任期有一条日志被提交后，才能一并算作已提交。`leaderCommit` 不能超过本节点已匹配的最后下标。
5. 应用：`commitIndex` 前进时按顺序调用 `onApply(command)`，且每条命令在整个生命周期（含崩溃恢复）只应用一次。`lastApplied` 必须写入 `persist`。
6. 快照：`installSnapshot` 在 term 不落后时生效。丢弃 `lastIncludedIndex` 及之前的日志，持久化快照；若 `lastApplied < lastIncludedIndex`，用快照 `data` 调用一次 `onApply(data)` 并把 `lastApplied` 提到 `lastIncludedIndex`。之后不得再应用已被快照覆盖的旧命令。
7. `propose` 仅 leader 成功，返回 `{index, term}`；否则返回 `null`。`crash()` 只丢掉内存角色与计时，不改 `persist`。用 `RaftNode.recover(opts)` 从同一 `persist` 恢复为 follower，且不要重复 `onApply`。
8. 不要引入外部依赖，不要改测试。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
