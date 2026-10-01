请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Dijkstra–Scholten 终止检测** 任务：n 个进程构成连通无向图，指定 `rootId` 为扩散计算发起者。消息：
- `{ kind:"MSG", from, msgId }` — 计算消息
- `{ kind:"ACK", from, msgId }` — 确认

语义（经典 DS 简化版）：
1. `start()`：仅 root 进入 **engaged**，`parent=null`，`deficit=0`，`active=true`；若已 start 过 → `BusyError`。
2. `send(from, to)`：`from` 必须 engaged 且为邻居；`deficit[from] += 1`，向 `to` 投递 MSG。非法 id/非邻居/未 engaged → 对应错误（`InvalidProcessError` / `InvalidConfigError` / `BusyError`：未 start 时 send → BusyError）。
3. `step(id)` 处理队头：
   - **MSG**：若本节点尚未 engaged：engaged=true，`parent=from`，`active=true`（不立即 ACK，该 MSG 记在参与树上）。若已 engaged：立即向 `from` 回 ACK，且 `active=true`。
   - **ACK**：`deficit -= 1`（若 deficit 已 0 仍收到 → `InvalidConfigError`）。然后 `tryDissolve(id)`。
4. `localDone(id)`：将 `active=false`，再 `tryDissolve(id)`。未 engaged → `BusyError`。
5. `tryDissolve(id)`（内部逻辑，可私有）：若 engaged 且 `!active` 且 `deficit===0`：若有 parent，向 parent 发 ACK 并 disengage（engaged=false，parent=null）；若无 parent（root），则 `terminated=true`。
6. `terminated()`：root 已宣布终止。
7. `pump` / `isEngaged` / `parentOf` / `deficitOf` / `isActive` / `neighborsOf` / `inboxSize` / `rootId()` / `reset()`。
8. 本任务**不要求** `setOnline`；全部节点始终 online。禁止真实网络/DB/`setTimeout`。可注入 `VirtualClock`。

构造：`new DSTerm({ clock, processCount=5, edges?, rootId=0 })`。默认 n=5，线树边 `[[0,1],[1,2],[2,3],[3,4]]`。`processCount<2`、不连通、`rootId` 非法 → `InvalidConfigError`。

导出：`defaultEdges`、`buildNeighbors`、`isConnected`。

模块：`clock` / `types` / `errors` / `graph` / `process` / `dsterm` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
