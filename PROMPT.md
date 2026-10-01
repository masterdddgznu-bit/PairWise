请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **GHS 风格最小生成树（简化片段合并）** 任务：n 个进程构成**带边权**的连通无向图，**边权全局唯一**。每个节点初始为独立**片段**（fragment），片段有 `leader`（初始=自身 id）与片段树（`parent`/`children`，初始无边）。边状态：`basic` | `branch` | `rejected`（初始全部 basic）。

一轮推进：
1. **FIND（找 MWOE）**：`begin()` 启动。每个节点按边权升序对仍为 `basic` 的邻边发 `{ kind:"TEST", frag, from, msgId }`。邻居若同片段回 `{ kind:"REJECT" }`（该边变 `rejected`）；否则回 `{ kind:"ACCEPT" }`。节点在得到一条 ACCEPT 后，将该边作为本地候选；若所有 basic 邻边都 REJECT 则候选为空。沿当前片段树向 leader **汇聚** `{ kind:"REPORT", best: {u,v,w}|null, from, msgId }`：孩子先 REPORT，父取权更小者（权唯一）。leader 得到片段 MWOE（可能为 null）。
2. **MERGE**：若 leader 的 MWOE 为 `{u,v,w}`，向该边对端发 `{ kind:"CONNECT", frag, level, from, msgId }`（本任务 `level` 恒为片段大小或 0 即可，测试不检查 level 语义，但消息需带 `level:number`）。合并规则（简化）：两片段沿 MWOE 互相 CONNECT（或一端已是对方 MWOE）后，将 MWOE 标为 `branch`，合并为同一片段：新 `leader = min(原两 leader)`，片段树把 MWOE 两端用 parent/children 连起（较小 leader 一侧为根方向），所有原属两片段的节点 `frag` 更新为新 leader。若某片段 MWOE 为 null 且图中仍有多个片段 → `InvalidConfigError`（权不唯一或图不连通等异常；默认测试不会触发）。
3. 仅当**全部**片段的 FIND+MERGE 在本轮完成后，才允许下一轮 `begin()`。当只剩 **1 个片段** 且无进行中的 FIND/MERGE 时 `done()===true`，`mstEdges()` 为所有 `branch` 边。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`。

语义约束（测试会覆盖）：
- 构造：`new GHS({ clock, processCount=6, edges? })`，`edges` 为 `{u,v,w}[]`。默认见 `defaultEdges(6)`。`processCount<2`、不连通、边权非唯一、端点非法 → `InvalidConfigError`。
- 导出：`defaultEdges`、`buildNeighbors`（含权）、`isConnected`、`edgeKey(u,v)`。
- `reset()`：恢复初始片段/边状态/inbox。
- `begin()`：若 FIND/MERGE 进行中 → `BusyError`；若已 `done()` → 返回 0。否则启动所有片段的 FIND（从各节点对 basic 边发 TEST 或启动汇聚）。返回本步发出消息条数。
- `step(id)` / `pump(to?)`：处理 TEST/REJECT/ACCEPT/REPORT/CONNECT；offline 不要求（全部保持 online）。
- `fragmentOf` / `leaderOf` / `parentOf` / `childrenOf` / `edgeState(u,v)` / `mstEdges()`（`[u,v,w]` 按 w 升序）/ `mstWeight()` / `done()` / `barrier()`（循环 begin+pump 直至 done，返回 mstWeight）
- `neighborsOf(id)` 返回 `{id,w}[]` 按 w 升序；`inboxSize`

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息与边类型
- `src/errors.ts` — 错误类型
- `src/graph.ts` — 图工具
- `src/process.ts` — 单进程状态
- `src/ghs.ts` — `GHS` 门面
- `src/index.ts` — 统一导出

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
