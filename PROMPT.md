请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Yo-Yo 领袖选举** 任务：n 个进程构成连通无向图，每个进程有唯一整数 `uid`。维护 **active** 无向边集合（初始为全部边）。每一轮：

1. **定向**：对每条两端均 online 的 active 边 `{u,v}`，若 `uid[u] > uid[v]` 则定向为 `u → v`（指向更小 uid）。**源** = 入度为 0（局部最大）；**汇** = 出度为 0（局部最小）。
2. **DOWN**：每个源沿全部出边发送 `{ kind:"DOWN", cand: uid[源], from, msgId }`。内部节点收齐全部入边 DOWN 后，令 `cand = max(收到的 cand)`，沿全部出边转发 DOWN(cand)。汇点收齐入边 DOWN 后开始 UP（既源又汇则直接完成本地一轮）。
3. **UP**：汇点令 `best = max(入边 cand)`。对每条入边回 `{ kind:"UP", keep: (该边 cand===best), from, msgId }`。内部节点收齐全部出边 UP 后：若存在 keep=true，则在所有 `cand===best` 的入边中只对 **from uid 最大** 的那一条回 keep=true，其余入边 keep=false；若全部出边 keep=false，则所有入边 keep=false。对收到 keep=false 的出边，将对应无向边从 active 删除。源收齐出边 UP 后同样按 keep=false 删边。
4. 一轮完整结束后重新定向；若此时 online 节点中恰好一个源，则其 `uid` 为领袖，`converged()===true`（算法开始前即使已有唯一局部最大，也需至少成功跑完一轮后才 converged）。

`begin()` 启动一轮 DOWN。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`。

语义约束（测试会覆盖）：
- 构造：`new YoYo({ clock, processCount=5, edges?, uids? })`。默认 n=5，`uids=[10,30,20,50,40]`，`edges=[[0,1],[1,2],[2,3],[3,4],[4,0],[1,3]]`。`processCount<2`、uids 非唯一/长度不符、图不连通 → `InvalidConfigError`。
- 导出：`defaultEdges` / `defaultUids`、`buildNeighbors`、`isConnected`。
- 初始：全部 online；active=全部边；inbox 空；未在轮次中。
- `reset()`：恢复初始（含 active）。
- `begin()`：若轮次进行中（存在节点仍在等 DOWN/UP）→ `BusyError`。若已 `converged()` → 返回 0。校验 online 导出子图连通且 ≥1 个 online，否则 `InvalidConfigError`。对每个当前源启动 DOWN（既源又汇则立即完成本地并可能删边）。返回发出消息条数。
- `step(id)`：offline → `OfflineError`；空 → false。处理 DOWN/UP；忽略非法/过期消息仍消费。返回 true。
- `pump(to?)` / `uidOf` / `activeNeighbors(id)`（升序）/ `outNeighbors` / `inNeighbors`（按当前定向，仅 online+active）/ `isSource` / `isSink` / `sources()`（升序 id）/ `leader()`（converged 时返回领袖 uid，否则 null）/ `converged()` / `barrier()`（循环 begin+pump 直至 converged 或卡住，返回 leader()；已 converged 则直接返回）
- `neighborsOf` / `inboxSize` / `setOnline` / `isOnline`
- 轮次进行中 `setOnline` → `BusyError`。向 offline 不投递。删边只影响 active，不影响 `neighborsOf` 静态图。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/graph.ts` — defaultEdges / defaultUids / buildNeighbors / isConnected
- `src/process.ts` — 单进程状态
- `src/yoyo.ts` — `YoYo` 门面
- `src/index.ts` — 统一导出

对外 API 以 `YoYo` / `VirtualClock` / graph 工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
