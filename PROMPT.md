请在当前 TypeScript 仓库中补全 `src/cluster.ts`，使 `npm test` 与 `npm run build` 全部通过。

目标：实现进程内的 PBFT（Practical Byzantine Fault Tolerance）集群 `Cluster`。测试只注入崩溃故障（漏消息），但协议必须按 `n = 3f+1`、阶段法定人数 `2f+1` 来写。没有真实网络，用同步调用模拟副本间消息。

必须满足：
1. 只允许修改 `src/`；禁止修改 `tests/`。
2. `new Cluster(nodeIds)`：`nodeIds.length` 必须满足 `n % 3 === 1` 且 `n >= 4`（即 `n=3f+1`）。`f = (n-1)/3`，阶段法定人数 `q = 2f+1`。初始 `view = 0`，主节点 `primary = nodeIds[view % n]`，全部在线、`mode = "normal"`，各自 `seq = 0`（已接受的最大序号），`lastExec = 0`，日志为空。
3. 日志项：`{ view, seq, command }`。`seq` 从 1 递增。每个节点还要能记录：某 `(view, seq, command)` 的 Prepare 投票集合、Commit 投票集合；以及是否已对该三元组发出过 Prepare/Commit（避免重复计数时逻辑自洽即可）。
4. `primary()`：若 `nodeIds[view % n]` 在线且 `mode==="normal"` 且其 `view` 等于集群已安装 view，返回该 id，否则 `null`。集群已安装 view = 所有 `mode==="normal"` 节点的最大 view；若没有 normal 节点，则取所有节点 view 的最大值。
5. `request(command)`（客户端请求）：
   - 若无可用主节点，抛错。
   - 主节点分配 `seq = primary.seq + 1`，追加日志项，并向所有在线副本（含自己的本地路径）进入 Pre-Prepare：备份接受条件为 `mode==="normal"`、`view` 相同、该 `seq` 尚未接受冲突命令；接受后更新本地日志/`seq`，并广播 Prepare(view, seq, command, sender)。
   - 任意节点（含主）在收到 Prepare 后，把 sender 记入该三元组的 prepareVotes。当某节点自己已接受该请求（有日志项）且 prepareVotes 大小（含自己的一票；自己若还没显式投票，接受 Pre-Prepare/自己提出时也算一票）达到 `q` 时，进入 prepared，广播 Commit(view, seq, command, sender)。
   - 节点把 Commit 记入 commitVotes；当 commitVotes 达到 `q` 且本地已 prepared 时，把该 seq 标记 committed，并按序号连续执行：推进 `lastExec`，把命令追加到已执行列表。
   - 若最终该 `seq` 未能在主节点上执行成功（例如在线节点不足以形成 Commit 证书），抛错；允许日志中残留未执行项。成功则返回 `seq`。
6. `fail(id)` / `recover(id)`：下线/上线。`recover` 后若存在 view 不低于本节点的 normal 快照（优先更高 view，其次更大 `lastExec`/`seq`），安装其 `view/log/seq/lastExec/已执行列表` 并进入 normal；否则仅上线。未知 id 抛错。
7. `requestViewChange(id)`：
   - 目标 `v = 已安装 view + 1`。向所有在线节点收集 ViewChange：节点若 `lastViewChange < v` 则接受，设 `lastViewChange = v`、`mode="view-change"`，返回 `{ id, view, log, seq, lastExec, prepared }`，其中 `prepared` 为本地已达到 prepared 但可能尚未执行的项列表（深拷贝）。若接受数 `< q`：回滚本轮 mode/lastViewChange，抛错。
   - 否则新主为 `nodeIds[v % n]`。从法定人数回复中选取基底日志：取 `view` 最大者；并列取 `seq` 最大者；再并列取 `id` 字典序最小。再把所有回复里的 prepared 项合并进基底（同 seq 以更高 view 为准；同 view+seq 要求 command 一致，否则以基底为准）。新主安装 `view=v`、合并后的日志/`seq`/`lastExec=max(回复 lastExec)`，进入 normal，并向所有在线节点发 NewView；节点安装后进入 normal（`lastExec` 取 max）。新主不自动重放未执行请求；后续由新的 `request` 继续分配更大 seq。
8. `committed(id)` 返回该节点已执行命令列表（按 seq 升序）。`status(id)` 返回 `{ view, seq, lastExec, up, mode }`。`stats()` 返回 `{ view, primary, up, executed }`：已安装 view、`primary()`、在线数、主节点的 `lastExec`（无主则为 0）。
9. 不要引入外部依赖，不要改测试。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
