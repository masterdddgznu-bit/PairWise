请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **异步 BFS（Asynchronous BFS）** 任务：n 个进程构成连通无向图。`start(rootId)` 令 root 的 `dist=0` 并向 online 邻居发送 `PULSE`；节点收到来自 `from`、携带距离 `d` 的脉冲时，候选距离为 `d+1`：若尚未有距离或候选 **严格更小**，则更新 `dist`、将 `parent` 设为 `from`，并向所有 **online 邻居**（含来源）继续发送携带自身新 `dist` 的 `PULSE`；若候选 **等于** 当前 `dist`，保留先到的 `parent`（不改父、不转发）；若候选更大则忽略。收敛后，全体 online 且从 root 经 online 边可达的节点具有有限 `dist`，且 `parent` 边构成以 root 为根的 BFS 生成树。`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以消息队列为准）。

语义约束（测试会覆盖）：
- 构造：`new AsyncBfs({ clock, processCount=4, edges? })`。未给 `edges` 且 n=4 时默认 `[[0,1],[1,2],[2,3],[0,3]]`（环）。`processCount<2`、edges 不能构成连通无向简单图（合法端点、无自环、无重边；允许有环连通图）→ `InvalidConfigError`。
- 导出 `defaultEdges(4)`、`buildNeighbors(n, edges)`（邻接表，每行邻居升序）、`isConnected(n, edges)`。
- 初始：全部 online；`dist=null`；`parent=null`；inbox 空。
- `start(rootId)`：非法 id → `InvalidProcessError`；root offline → `OfflineError`；若已有进行中的扩散（已 start 且尚未 `converged`）→ `BusyError`。重置全体：`dist=null`、`parent=null`、inbox 空。设 root `dist=0`、`parent=null`，向每个 **online** 邻居追加 `{ kind:"PULSE", d:0, from:root, msgId }`（新 msgId）。返回本次发出条数。不立即处理。允许在 `converged` 之后再次 `start`。
- `step(id)`：offline → `OfflineError`；inbox 空 → false。取队头 PULSE：
  - `cand = msg.d + 1`
  - 若 `dist===null` 或 `cand < dist`：设 `dist=cand`、`parent=msg.from`；向所有 **online 邻居**（含来源）各发 `{ kind:"PULSE", d:dist, from:id, msgId }`
  - 若 `dist!==null` 且 `cand === dist`：忽略（不改 parent、不转发）
  - 若 `cand > dist`：忽略
  返回 true。
- `pump(to?)`：指定 to 则反复 step；否则轮转 online 直到一轮无进展。
- `converged()`：已成功 start 过；所有 **online** inbox 皆空；且每个 online 节点：要么 `dist===null`（经 online 子图从 root 不可达），要么 `dist` 为非负整数；并且 **每个** `dist!==null` 的非 root 节点满足 `parent!==null` 且 `distOf(parent)===dist-1`；root 的 `dist===0` 且 `parent===null`。若 start 后 root 无任何 online 邻居且自身 dist=0，也视为可收敛（pump 后 inbox 空即可）。
- `rootId()`：最近一次成功 start 的 root；未 start 过为 `null`。
- `distOf(id)` / `parentOf(id)`：当前值（可为 `null`）。
- `childrenOf(id)`：所有 online 且 `parent===id` 的下标，**升序**。
- `inTree(id)`：`distOf(id)!==null`
- `treeEdgeCount()`：online 且 `parent!==null` 的节点数。
- `neighborsOf` / `inboxSize` / `setOnline` / `isOnline`
- 向 offline 邻居：**不**投递。`pump` 跳过 offline。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/graph.ts` — defaultEdges / buildNeighbors / isConnected
- `src/process.ts` — 单进程状态
- `src/asynbfs.ts` — `AsyncBfs` 门面
- `src/index.ts` — 统一导出

对外 API 以 `AsyncBfs` / `VirtualClock` / graph 工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
