请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Raft 选主**（不含日志复制）任务：多节点 Follower/Candidate/Leader；`tick()` 推进 VirtualClock 并处理选举超时与心跳；RequestVote 需多数才能当选；Leader 周期性心跳重置 Follower 选举计时；更高 term 消息迫使降级；`setOnline` 模拟分区。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过注入的 `VirtualClock` 推进。

语义约束（测试会覆盖）：
- 构造：`new RaftVote({ clock, nodeCount=5, electionTimeout=10, heartbeatInterval=3 })`
- 节点 id 为 `0 .. nodeCount-1`；多数派 = `floor(nodeCount/2)+1`（相对**配置全集群**，不是在线数）
- 初始：全部 `follower`，`term=0`，`votedFor=null`；选举截止时刻 `electionDeadline = electionTimeout + nodeId`（用 nodeId 作确定性抖动，避免同时超时）
- `role(id)` / `term(id)` / `votedFor(id)` / `leaderId()`（若存在唯一 Leader 则为其 id，否则 `null`）
- `setOnline(id, online)`：离线节点不发送也不接收任何 RPC；已是 Leader 若离线则失去领导（`leaderId()` 不再返回它），但其 term 等本地状态保留；**重新上线**时须把 `electionDeadline` 重置为 `now + electionTimeout + nodeId`，避免带着过期截止立刻抢选
- `tick()`：`clock.advance(1)`，然后：
  1. 每个在线 Leader：若 `now >= lastHeartbeatAt + heartbeatInterval`，向所有**在线**节点发心跳（含自己可忽略），重置自己的 `lastHeartbeatAt=now`；收到合法心跳的 Follower/Candidate：若 `hb.term >= local.term`，则采纳 term、降为 follower、`votedFor` 保持或按实现清空均可但须能再次投票于新 term、重置 `electionDeadline = now + electionTimeout + nodeId`
  2. 每个在线且非 Leader 的节点：若 `now >= electionDeadline`，发起选举：`term++`，角色 `candidate`，`votedFor=self`，自票 1，重置 `electionDeadline`；向其他在线节点发 `RequestVote(term, candidateId)`
- `RequestVote` 处理（接收方在线时）：
  - 若 `req.term < local.term`：拒绝
  - 若 `req.term > local.term`：更新 `term`、降为 follower、`votedFor=null`
  - 若 `votedFor===null` 或 `votedFor===candidateId`：授票，设置 `votedFor`，重置选举截止；候选人计入该票
  - 候选人票数达到 majority → 成为 Leader，`lastHeartbeatAt=now`，并**立即**发一轮心跳
- 同一 term 只授一票；Follower 收到更低 term 心跳忽略
- `majorityOf` / `hasQuorum` 导出在 `quorum.ts`

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — `Role` 等
- `src/errors.ts` — `RaftVoteError` / `InvalidNodeError`
- `src/quorum.ts` — majority / hasQuorum
- `src/node.ts` — 单节点状态
- `src/rpc.ts` — RequestVote / Heartbeat 数据结构（可选纯类型）
- `src/election.ts` — 选举辅助（可选）
- `src/raftvote.ts` — `RaftVote` 门面
- `src/index.ts` — 统一导出

对外 API 以 `RaftVote` / `VirtualClock` / 错误类型 / `majorityOf` / `hasQuorum` 为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
