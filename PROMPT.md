请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Alon–Babai–Itai MIS** 教学简化版：n 个顶点（id `0..n-1`），无向简单连通图由 `edges` 给出。随机性只来自注入 `Rng`（禁止 `Math.random`）。

顶点状态：`active`（仍在竞争）、`inMis`、`blocked`（邻居已入 MIS，退出竞争）。

消息（沿边）：
- `{ kind:"MARK"; from: number; round: number }` — 本轮自我标记
- `{ kind:"JOIN"; from: number; round: number }` — 宣布加入 MIS

语义：
1. `start()`：全部 `active=true`，`inMis=false`，`blocked=false`，`roundIndex=0`。重复 → `BusyError`。未 start 跑阶段 → `BusyError`。
2. 每一轮 `abiRound()`（若已无 active 顶点则置完成并返回 `false`）：
   - **标记**：对每个仍 `active` 的 v，令 `d = freeDeg(v)`（active 邻居数）。令 `mod = max(2*d, 1)`。取 `r = rng.nextInt() % mod`；若 `r === 0` 则标记并对其邻居发 `MARK`。
   - `pump()`。
   - **决胜加入**：对每个已标记且仍 active 的 v：若存在标记的 active 邻居 `u` 且 `u < v`，则 v 本轮不加入；否则 v 加入 MIS（`inMis=true`，`active=false`），对邻居发 `JOIN`。
   - `pump()`。
   - **封锁**：收到 `JOIN` 且自身仍 active 的顶点变为 `blocked`（`active=false`）。清除本轮标记。
   - `roundIndex++`。若仍有 active 返回 `true`，否则完成返回 `false`。
3. `run()`：`start()` 后反复 `abiRound()` 直到返回 `false`（或达 `maxRounds`，默认 `32`，构造可覆盖）。
4. 查询：`isActive` / `inMis` / `isBlocked` / `freeDeg` / `mis(): number[]`（升序）/ `isIndependent()` / `isMaximal()` / `neighborsOf` / `roundIndex()` / `phase()`（`idle|running|done`）/ `inboxSize` / `step` / `pump` / `reset()`。
5. 导出：`defaultEdges`（路径）、`buildNeighbors`、`isConnected`、`isSimpleUndirected`、`markModulus(d)`（`=max(2*d,1)`）。
6. `Rng`：`nextInt(): number`；提供 `SeqRng`。
7. 禁真实网络/DB/`setTimeout`/`Math.random`。可注入 `VirtualClock`。

构造：`new AbaRule({ clock, rng, processCount=5, edges?, maxRounds? })`。
- `n<1`、非简单无向、不连通 → `InvalidConfigError`。

模块：`clock` / `rng` / `types` / `errors` / `graph` / `process` / `abarule` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
