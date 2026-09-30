请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Tarry 图遍历 / 生成树** 任务：n 个进程构成连通无向图。`start(rootId)` 由 initiator 持有令牌，向某个 online 邻居发出 `TOKEN`；节点首次收到令牌时记录入口边（`parent`）；之后优先把令牌发向尚未用过的 online 邻居（**升序选最小 id**，且优先非入口边）；若只剩入口边或没有其他未用边，则经入口边把令牌送回父节点；initiator 在令牌回到自身且自身已无未用边时宣布完成。入口边构成以 root 为根、覆盖全体 online 可达节点的生成树。`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以消息队列为准）。

语义约束（测试会覆盖）：
- 构造：`new Tarry({ clock, processCount=4, edges? })`。未给 `edges` 且 n=4 时默认 `[[0,1],[1,2],[2,3],[0,3]]`（环）。`processCount<2`、edges 不能构成连通无向简单图（合法端点、无自环、无重边；允许有环连通图）→ `InvalidConfigError`。
- 导出 `defaultEdges(4)`、`buildNeighbors(n, edges)`（邻接表，每行邻居升序）、`isConnected(n, edges)`。
- 初始：全部 online；未 start 前无人 visited；inbox 空。
- `start(rootId)`：非法 id → `InvalidProcessError`；root offline → `OfflineError`；若已有进行中的遍历（已 start 且尚未 `converged`）→ `BusyError`。重置全体：`visited=false`、`parent=null`、`used` 空、inbox 空、`decided=false`。将 root 标 visited、parent=null；在 root 的 online 邻居中选 **最小 id** 发送 `{ kind:"TOKEN", from:root, msgId }`，并把该邻居记入 root 的 `used`。若 root 无 online 邻居，则立即 `decided=true`。返回发出条数（0 或 1）。不立即处理。允许在 `converged` 之后再次 `start`。
- `step(id)`：offline → `OfflineError`；inbox 空 → false。取队头 TOKEN（from=`src`）：
  - 若尚未 visited：`visited=true`，`parent=src`。
  - 然后按 Tarry 转发：
    - 令候选 = 所有 online 邻居中 **尚未 used** 的集合。
    - 若存在候选 `nb != parent`（root 的 parent 视为 `null`，即任意未用邻居均可）：选其中 **最小 id**，标记 used，向其发 TOKEN。
    - 否则若 `parent !== null`：将 `parent` 标记 used（若尚未），向 `parent` 发 TOKEN。
    - 否则（initiator 且无未用边）：`decided=true`，不再发送。
  - 返回 true。
- `pump(to?)`：指定 to 则反复 step；否则轮转 online 直到一轮无进展。
- `converged()`：`decided===true` 且所有 online inbox 皆空。
- `rootId()`：最近一次成功 start 的 root；未 start 过为 `null`。
- `parentOf(id)` / `childrenOf(id)`（online 且 parent===id，升序）/ `inTree(id)`（visited）/ `treeEdgeCount()`（online 且 parent≠null 的节点数）
- `neighborsOf` / `inboxSize` / `setOnline` / `isOnline`
- 向 offline 邻居：**不**投递，也不进入 used 候选。`pump` 跳过 offline。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/graph.ts` — defaultEdges / buildNeighbors / isConnected
- `src/process.ts` — 单进程状态
- `src/tarry.ts` — `Tarry` 门面
- `src/index.ts` — 统一导出

对外 API 以 `Tarry` / `VirtualClock` / graph 工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
