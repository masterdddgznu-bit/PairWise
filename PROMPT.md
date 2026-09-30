请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **分布式 DFS 生成树** 任务：n 个进程构成连通无向图。`start(rootId)` 由 initiator 向某个 online 邻居发出 `EXPLORE`；节点**首次**收到 EXPLORE 时设 `parent`，并继续向尚未尝试过的 online 邻居（升序最小 id，且 ≠parent）发 EXPLORE；若节点**已访问**则立即向来源回 `RETURN`（该边不是树边）；节点收到 RETURN 后尝试下一个未用邻居，若无则向 `parent` 回 RETURN；initiator 在无未用邻居且令牌逻辑结束后 `decided`。`parent` 边构成 DFS 生成树。与 Tarry 不同：已访问节点不借道继续遍历，只立即 RETURN。`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以消息队列为准）。

语义约束（测试会覆盖）：
- 构造：`new DfsTree({ clock, processCount=4, edges? })`。未给 `edges` 且 n=4 时默认 `[[0,1],[1,2],[2,3],[0,3]]`（环）。`processCount<2`、edges 不能构成连通无向简单图 → `InvalidConfigError`。
- 导出 `defaultEdges(4)`、`buildNeighbors(n, edges)`（邻接表升序）、`isConnected(n, edges)`。
- 初始：全部 online；未 start 前无人 visited；inbox 空。
- `start(rootId)`：非法 id → `InvalidProcessError`；root offline → `OfflineError`；进行中（已 start 且未 `converged`）→ `BusyError`。重置全体：`visited=false`、`parent=null`、`used` 空、inbox 空、`decided=false`。root `visited=true`、`parent=null`；在 online 邻居中选最小 id 发 `{ kind:"EXPLORE", from:root, msgId }` 并记入 `used`。无 online 邻居则立即 `decided=true`。返回 0 或 1。允许 converged 后再次 start。
- `step(id)`：offline → `OfflineError`；inbox 空 → false。取队头：
  - **EXPLORE** from `src`：
    - 若已 visited：向 `src` 发 RETURN，返回 true（不改 parent/used）。
    - 若未 visited：`visited=true`，`parent=src`；然后执行 `advance(id)`（见下）。
  - **RETURN** from `src`：执行 `advance(id)`。
  - `advance(id)`：在 online 且未 used 且 ≠parent 的邻居中选最小 id；若有则标记 used 并对其发 EXPLORE；否则若 `parent!==null` 则向 parent 发 RETURN；否则（root）`decided=true`。
  返回 true。
- `pump(to?)`：指定 to 则反复 step；否则轮转 online 直到一轮无进展。
- `converged()`：`decided` 且所有 online inbox 空。
- `rootId()` / `parentOf` / `childrenOf`（online 且 parent===id，升序）/ `inTree`（visited）/ `treeEdgeCount`
- `neighborsOf` / `inboxSize` / `setOnline` / `isOnline`
- 向 offline：**不**投递，不进入候选。`pump` 跳过 offline。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/graph.ts` — defaultEdges / buildNeighbors / isConnected
- `src/process.ts` — 单进程状态
- `src/dfstree.ts` — `DfsTree` 门面
- `src/index.ts` — 统一导出

对外 API 以 `DfsTree` / `VirtualClock` / graph 工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
