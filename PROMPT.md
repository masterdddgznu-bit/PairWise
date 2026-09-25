请在当前 TypeScript 仓库中补全 `src/cluster.ts`，使 `npm test` 与 `npm run build` 全部通过。

目标：实现进程内的 Viewstamped Replication 集群 `Cluster`。没有真实网络，用同步调用模拟副本之间的协议消息。

必须满足：
1. 只允许修改 `src/`；禁止修改 `tests/`。
2. `new Cluster(nodeIds)`：`nodeIds` 长度必须为奇数且 ≥ 3，顺序固定。法定人数大小为 `floor(n/2)+1`。初始 `view = 0`，主键（primary）为 `nodeIds[view % n]`，每个节点 `op-number = 0`、`commit-number = 0`、日志为空，全部在线，角色为 normal。
3. 每个日志项为 `{ view, opNum, command }`，`opNum` 从 1 递增。节点持久化（进程内即可）：`view`、`op-number`、日志、`commit-number`、以及「上次参与的 view-change 的目标视图」`lastTried`（初始 0）。
4. `primary()`：若当前主键在线且处于 normal，返回其 id；否则返回 `null`。
5. `propose(command)`：
   - 若当前无可用主键，抛错。
   - 主键把 `op-number` 加一，追加日志项 `{view, opNum, command}`，并向**所有其它在线**副本做 Prepare（携带 view、opNum、command、commit-number、以及该 opNum 之前的日志前缀，足以让落后副本补齐到 opNum-1）。
   - 副本接受 Prepare，当且仅当：请求的 view 等于自己的 view、自己处于 normal、且本地日志可以与请求前缀对齐（若本地更短则追加缺失项；若同 opNum 冲突则拒绝）。接受后更新本地 op-number/日志，并按携带的 commit-number 推进本地 commit（见下）。
   - 主键自己算一票。若收到的 PrepareOk（含自己）≥ 法定人数，则把 `commit-number` 推进到该 opNum，并让所有在线副本把 commit-number 提升到至少该值；返回该 opNum。否则抛错，且该次命令不得变为已提交（允许日志里残留未提交项）。
6. 提交应用：`committed(id)` 返回该节点日志中 `opNum <= commit-number` 的 `command` 列表（按 opNum 升序）。推进 commit-number 时不得跳过空洞。
7. `fail(id)` / `recover(id)`：下线/上线。上线后仍是旧状态，不自动追赶；角色保持，但若 view 已变且自己不是新协议下的 normal 参与者，需靠后续 StartView / Propose 补齐。对未知 id 抛错。
8. `requestViewChange(id)`：由在线节点 `id` 发起，目标视图 `v = (当前集群已安装 view) + 1`。集群已安装 view 取所有节点中 `mode == normal` 的最大 `view`；若没有 normal 节点，则取所有节点 `view` 的最大值。
   - 向所有在线节点（含自己）收集 DoViewChange。节点接受条件：`lastTried < v`。接受后暂存旧 `lastTried/mode`，设 `lastTried = v` 并进入 `view-change`，返回 `{ nodeId, view, log, opNum, commitNum, lastNormalView }`（`lastNormalView` 为进入本次 view-change 前最后一次 normal 的 view；若节点已在 view-change，用其进入前记录的值）。
   - 若回复数 < 法定人数：回滚本轮所有接受节点的 `lastTried/mode`，抛错；已安装 view 不变。
   - 若达到法定人数：新主键为 `nodeIds[v % n]`。在回复中选日志：`lastNormalView` 最大优先；并列则 `opNum` 最大优先；再并列取 `nodeId` 字典序最小者的日志。新主键安装日志与 opNum，设 `view = v`、`commit-number = max(自身 commit, 回复中最大 commitNum)`，进入 normal，并向**当时在线**的全部副本发 StartView(v, log, opNum, commitNum)；副本安装后 `view=v`、替换日志/opNum/commitNum（commitNum 取 max(本地, 消息)）、进入 normal。
   - `recover(id)`：节点重新上线。若存在 view 不低于本节点的 normal 快照（优先 view 最高，其次 opNum 最高），则立即安装该快照（view/log/opNum/commitNum）并进入 normal。否则仅标记上线，保留旧状态。
9. `status(id)` 返回 `{ view, opNum, commitNum, up, mode }`，`mode` 为 `"normal" | "view-change"`。`stats()` 返回 `{ view, primary, up, committed }`：当前 view、`primary()` 值、在线数、主键的 commit-number（无主键则为 0）。
10. 不要引入外部依赖，不要改测试。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
