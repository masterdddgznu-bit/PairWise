请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Gamma 同步器（Gamma Synchronizer）** 任务：n 个进程构成连通无向图，并划分为若干**簇**。每个簇有一棵生成树与簇根。一轮脉冲推进分两段：
1. **簇内 Beta（UP/DOWN）**：online 叶子向 parent 发 `{ kind:"UP", pulse, from, msgId }`；内部节点收齐全部 online 子节点同号 UP 后向 parent 转发；簇根收齐后**不立刻 +1**，进入 α。
2. **簇根 Alpha（PULSE）**：簇根向每个**相邻簇**的 online 簇根发 `{ kind:"PULSE", pulse, from, msgId }`；收齐全部相邻簇根的同号 PULSE 后，本簇根 `pulse+=1`，清空本轮状态，并向 online 子节点发 `{ kind:"DOWN", pulse:新脉冲, from, msgId }`；非根收到 DOWN 后设 `pulse`、清空 UP 状态并向下转发。

两簇相邻当且仅当存在一条图边，两端分属两簇。若某簇根没有相邻簇根，则本地 UP 收齐后立即 `pulse+=1` 并 DOWN（退化为纯 Beta）。`begin()` 启动各簇叶子 UP。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`。

语义约束（测试会覆盖）：
- 构造：`new GammaSync({ clock, processCount=6, edges?, treeEdges?, clusterOf?, clusterRoots? })`。
  - 默认 n=6：`clusterOf=[0,0,0,1,1,1]`，`clusterRoots=[0,3]`，`treeEdges=[[0,1],[1,2],[3,4],[4,5]]`，`edges=treeEdges+[[2,3]]`。
  - `processCount<2`、图不连通、`treeEdges` 不是覆盖各簇的森林、`clusterOf`/`clusterRoots` 非法 → `InvalidConfigError`。
- 导出：`defaultEdges` / `defaultTreeEdges` / `defaultClusterOf` / `defaultClusterRoots`、`buildNeighbors`、`isConnected`、`isForest`、`orientForest(n, treeEdges, clusterOf, clusterRoots)` → `{ parent, children }`（每簇以对应 root BFS 定向；children 升序；root 的 parent 为 null）、`clusterNeighbors(clusterId, …)`。
- 初始：全部 online；pulse=0；upSent=false；upRecv 空；emitted=false；recv 空；inbox 空。
- `reset()`：全体恢复初始。
- `begin()`：若任一 online 节点 `upSent` 或任一簇根 `emitted` → `BusyError`。校验每簇 online 导出相对簇根仍为树、簇根 online，否则 `InvalidConfigError`。对每个 online 且无 online 子节点的叶子发 UP（簇根若是叶子则直接走「本地收齐」逻辑）。返回发出消息条数。
- `step(id)`：offline → `OfflineError`；空 → false。
  - **UP**：`msg.pulse===pulse` 时记入 upRecv；收齐 online 子 UP 后：非根向 parent 发 UP 并 upSent=true；簇根进入 α（发 PULSE 或直接完成一轮）。
  - **PULSE**：仅簇根处理；同号则记入 recv；emitted 且收齐全部 online 相邻簇根后完成一轮（pulse+=1、DOWN）。
  - **DOWN**：设 pulse；清空 up/emitted/recv；向 online 子转发 DOWN。
  忽略错误脉冲号的 UP/PULSE（仍消费）。返回 true。
- `pump(to?)` / `pulseOf` / `minPulse` / `maxPulse` / `synced()`（online 同 pulse、inbox 空、全体 `upSent===false` 且簇根 `emitted===false`）
- `barrier(target)`：`minPulse()<target` 时循环 `begin()+pump`；`target<0` → `InvalidConfigError`。返回 `minPulse()`。
- `clusterOf(id)` / `clusterRoot(clusterId)` / `parentOf` / `childrenOf` / `leaderNeighbors(rootId)`（相邻簇 online 簇根，升序）
- `neighborsOf` / `inboxSize` / `setOnline` / `isOnline`
- 任一 `upSent` 或簇根 `emitted` 时 `setOnline` → `BusyError`。向 offline 不投递。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/graph.ts` — 图/簇/森林工具
- `src/process.ts` — 单进程状态
- `src/gammasync.ts` — `GammaSync` 门面
- `src/index.ts` — 统一导出

对外 API 以 `GammaSync` / `VirtualClock` / graph 工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
