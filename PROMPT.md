请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **树饱和极值选举（Saturation）** 任务：n 个进程构成一棵树（连通无环），各有唯一 `uid`。`start()` 让所有 **online 叶子**（online 邻居数 = 1）向其唯一 online 邻居发送 `PULSE(uid)`；节点记录来自邻居的 PULSE；当已收到「除恰好一个 online 邻居外」的全部 PULSE 且尚未饱和发送过，则向该剩余邻居发送 `PULSE(max(自身uid, 已收值))`；当已收到全部 online 邻居的 PULSE，则算出全局最大 `knownMax`，并向所有 online 邻居广播 `DONE(knownMax)`；收到 DONE 后若尚未持有 knownMax 则采纳并转发给其他 online 邻居。收敛后全体 online 的 `knownMax` 等于全局最大 uid，对应该 uid 的节点为领袖。`setOnline` 须在 `start` 前设置；online 导出的导出子图必须仍是树。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以消息队列为准）。

语义约束（测试会覆盖）：
- 构造：`new Satura({ clock, processCount=4, edges?, uids? })`。未给 `edges` 且 n=4 时默认线树 `[[0,1],[1,2],[2,3]]`。未给 `uids` 时为 `0..n-1`。`processCount<2`、edges 不是树（须连通、无自环/重边、且 `|E|=n-1`）、uids 非法 → `InvalidConfigError`。
- 导出 `defaultEdges(4)`、`defaultUids(n)`、`buildNeighbors(n, edges)`（邻接表升序）、`isConnected`、`isTree(n, edges)`（连通且 |E|=n-1）。
- 初始：全部 online；`knownMax=null`；`sentSat=false`；`recv` 空；inbox 空。
- `start()`：若进行中（已 start 且未 converged）→ `BusyError`。若 online 节点集合导出子图不是树（在 online 节点上连通且边数=onlineCount-1；只用两端都 online 的原边）→ `InvalidConfigError`。重置全体状态。对每个 online 且 online邻居数=1 的叶子：向该邻居发 `{ kind:"PULSE", value:uids[id], from:id, msgId }`，置 `sentSat=true`。返回发出条数。无叶子（例如单节点）则该点 `knownMax=uid` 且可立即视为可广播完成——n≥2 时至少有两片叶子。允许 converged 后再次 start。
- `step(id)`：offline → `OfflineError`；空 inbox → false。取队头：
  - **PULSE**：记 `recv[from]=value`。令 N=online 邻居集合。
    - 若 `|recv|===|N|-1` 且尚未 `sentSat`：令缺的邻居为 `nb`，`m=max(uid, ...recv values)`，向 `nb` 发 PULSE(m)，`sentSat=true`。
    - 若 `|recv|===|N|`：`knownMax=max(uid, ...recv values)`；向每个 online 邻居发 `{ kind:"DONE", value:knownMax, from:id, msgId }`（每个新 msgId）。
  - **DONE**：若 `knownMax===null`：设 `knownMax=value`；向所有 online 且 ≠from 的邻居转发 DONE(value)；若已有 knownMax 则忽略（不转发）。
  返回 true。
- `pump(to?)` / `converged()`：全体 online 的 `knownMax` 非 null 且相同，且 online inbox 皆空。
- `knownOf(id)` / `uidOf(id)` / `leaderUid()`（converged 则返回该共同 knownMax，否则 null）/ `leaderId()` / `isLeader(id)`
- `neighborsOf` / `inboxSize` / `setOnline` / `isOnline`
- 向 offline：**不**投递。`pump` 跳过 offline。`setOnline` 在已经 start 且未 converged 时调用 → `BusyError`。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/graph.ts` — defaultEdges / defaultUids / buildNeighbors / isConnected / isTree
- `src/process.ts` — 单进程状态
- `src/satura.ts` — `Satura` 门面
- `src/index.ts` — 统一导出

对外 API 以 `Satura` / `VirtualClock` / graph 工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
