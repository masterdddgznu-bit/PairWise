请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Luby MIS** 教学简化版：n 个顶点（id `0..n-1`），无向简单连通图由 `edges` 给出。随机性只来自注入 `Rng`（禁止 `Math.random`）。

消息（沿边）：
- `{ kind:"MARK"; from: number; rank: number; msgId: string }` — 本轮标记的随机优先级
- `{ kind:"JOIN"; from: number; msgId: string }` — 宣布加入 MIS
- `{ kind:"DROP"; from: number; msgId: string }` — 宣布退出活跃集（被邻居挤掉）

顶点状态：`active`（仍在竞争）、`inMis`、本轮 `rank`（若已标记）。

语义：
1. `start()`：全部 `active=true`，`inMis=false`。重复 → `BusyError`。图在构造时固定。
2. 每一轮（由 `round()` 显式推进，或 `pumpRounds()` 直到 MIS 极大）：
   - **标记**：每个 `active` 顶点抽 `rank = rng.nextInt()`（非负整数），向所有邻居发 `MARK{rank}`，并把自己的 rank 记入本地。
   - `pump()`：投递/处理消息直到本阶段静止。
   - **选举**：对每个仍 active 的 v，若其 `rank` **严格大于**所有仍 active 的邻居的 rank，则 v 加入 MIS（`inMis=true`），向邻居发 `JOIN`；否则若存在 active 邻居 rank > v.rank，则 v 本轮不加入（保持 active 等待 DROP 阶段——见下）。平 rank：id 更大者胜（视为更高优先级）。
   - **淘汰**：收到 `JOIN` 的 active 邻居必须退出：`active=false`，向其仍 active 的邻居发 `DROP`（可选，用于同步）；自己也不在 MIS。
   - 处理完 JOIN/DROP 后，清空本轮 rank；仍 active 且未 inMis 的进入下一轮。
3. 本题实现要求提供：
   - `round(): boolean` — 若已无 active 顶点返回 false；否则执行一整轮（标记→pump→选举/JOIN→pump→淘汰）并返回 true。
   - `run(): void` — 反复 `round()` 直到 false。
   - `step(id)` / `pump()` — 仅处理 inbox。
4. `isActive` / `inMis` / `mis(): number[]`（升序）/ `neighborsOf` / `inboxSize` / `isMaximal()`（MIS 独立且极大）/ `isIndependent()` / `reset()`。
5. 导出图工具：`defaultEdges(n)`（路径 `0-1-...-(n-1)`）、`buildNeighbors`、`isConnected`、`isSimpleUndirected`。
6. 禁真实网络/DB/`setTimeout`/`Math.random`。`Rng`：`nextInt(): number`（测试用 `SeqRng`）。

构造：`new Luby({ clock, rng, processCount=5, edges? })`。
- `n<1`、非简单无向、不连通 → `InvalidConfigError`。

模块：`clock` / `rng` / `types` / `errors` / `graph` / `process` / `luby` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
