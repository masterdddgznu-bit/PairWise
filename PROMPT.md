请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Echo 波 / 生成树** 任务：n 个进程构成连通无向图。`start(rootId)` 由 initiator 向全体 online 邻居发送 EXPLORE；节点首次收到 EXPLORE 时设 `parent`，并向**除来源外**的 online 邻居继续 EXPLORE；若已访问则立即向来源回 ECHO；对曾发出 EXPLORE 的邻居收齐 ECHO（叶子无待发邻居则立刻向父 ECHO）后向父回 ECHO；initiator 收齐后算法收敛，边 `(parent, child)` 构成以 root 为根、覆盖全体 online 节点的生成树。`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以消息队列为准）。

语义约束（测试会覆盖）：
- 构造：`new EchoWave({ clock, processCount=4, edges? })`。未给 `edges` 且 n=4 时默认 `[[0,1],[1,2],[2,3],[0,3]]`（环）。`processCount<2`、edges 不能构成连通无向简单图（合法端点、无自环、无重边；允许有环连通图）→ `InvalidConfigError`。
- 导出 `defaultEdges(4)`、`buildNeighbors(n, edges)`（邻接表，每行邻居升序）、`isConnected(n, edges)`。
- 初始：全部 online；未 start 前无人 `visited`；inbox 空。
- `start(rootId)`：非法 id → `InvalidProcessError`；root offline → `OfflineError`；若已有进行中的波（已 start 且尚未 `converged`，或任一 online inbox 非空）→ `BusyError`。重置全体：`visited=false`、`parent=null`、`children=[]`、`pending` 空、`decided=false`。将 root 标为 visited、parent=null，向其每个 **online** 邻居 inbox 追加 `{ kind:"EXPLORE", from:root, msgId }`（新 msgId），并把这些邻居记入 root 的 `pending`。若 root 无 online 邻居，则立即 `decided=true`。返回本次发出的消息条数。不立即处理。允许在 `converged` 之后再次 `start`。
- `step(id)`：offline → `OfflineError`；inbox 空 → false。取队头：
  - **EXPLORE** from `src`：
    - 若尚未 visited：`visited=true`，`parent=src`；向所有 **online 且 ≠src** 的邻居发 EXPLORE，将这些邻居写入 `pending`；若 `pending` 为空则执行本地完成（非 root：向 `parent` 发 ECHO；root：`decided=true`）。
    - 若已 visited：向 `src` 发一条 ECHO（不改 parent/pending）。
  - **ECHO** from `src`：若 `src` 在 `pending` 中则移除，并把 `src` 追加到 `children`（保持追加顺序）；若此后 `pending` 为空则同上本地完成。
  返回 true。
- `pump(to?)`：指定 to 则反复 step；否则轮转 online 直到一轮无进展。
- `converged()`：root 已 `decided`，且所有 **online** 进程 inbox 皆空。
- `rootId()`：最近一次成功 `start` 的 root；尚未 start 过则为 `null`。
- `parentOf(id)`：未 visited 则为 `null`；root 为 `null`；否则为父下标。
- `childrenOf(id)`：当前 `children` 副本（按收到 ECHO 的顺序）。
- `inTree(id)`：该进程 `visited`。
- `treeEdgeCount()`：online 且 visited 且 `parent≠null` 的节点数（生成树边数）。
- `neighborsOf(id)` / `inboxSize(id)` / `setOnline` / `isOnline`
- 向 offline 邻居：**不**投递（skip）。`start`/`step`：offline 的 step 抛 `OfflineError`；start 的 root 若 offline 抛 `OfflineError`。`pump` 跳过 offline。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/graph.ts` — defaultEdges / buildNeighbors / isConnected
- `src/process.ts` — 单进程状态
- `src/echowave.ts` — `EchoWave` 门面
- `src/index.ts` — 统一导出

对外 API 以 `EchoWave` / `VirtualClock` / graph 工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
