请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Linial 并行 Δ+1 着色** 教学简化版：n 个顶点（id `0..n-1`），无向简单连通图由 `edges` 给出。随机性只来自注入 `Rng`（禁止 `Math.random`）。

消息（沿边双向投递）：
- `{ kind:"COLOR"; from: number; color: number; round: number }`

顶点状态：当前 `color`、邻居最新已知色、inbox。

语义：
1. `start()`：全部 `color(i)=i`，`roundIndex=0`；向每个邻居广播 `COLOR` 并 `pump()`。重复 → `BusyError`。未 start 跑阶段 → `BusyError`。
2. 设 `delta = maxDegree(graph)`。第 r 轮调色板大小：
   `paletteSizeForRound(r) = min((2*delta+1) ** (2**r), n*n)`（整数幂，r≥0）。
3. **Linial 轮** `linialRound()`：
   - 若已 `isProper()` 且 `maxColor() <= delta`，置完成并返回 `false`。
   - 否则 `P = paletteSizeForRound(roundIndex)`。
   - 顶点按 **id 递增**依次重着色（模拟同步轮内 tie-break）。对顶点 v，令 `N` 为邻居**当前最新**色集合（含本轮已更新的更低 id 邻居）。从 `start = rng.nextInt() % P` 起，按 `(start+k)%P`（k=0..P-1）找**第一个**不在 `N` 中的颜色；若整圈都在 `N` 中，取 `start`。
   - 全部更新后 `roundIndex++`，向邻居广播新 `COLOR`，`pump()`。
   - 若更新后已 proper 且 `maxColor()<=delta`，标记完成并返回 `false`；否则返回 `true`。
4. `run()`：`start()` 后反复 `linialRound()` 直到返回 `false` 或已达 `maxRounds`（默认 `16`，构造可覆盖）。
5. 查询：`colorOf` / `colors()` / `neighborsOf` / `delta()` / `roundIndex()` / `isProper()` / `maxColor()` / `paletteSize()`（当前顶点色集合大小）/ `phase()`（`idle|running|done`）/ `inboxSize` / `step` / `pump` / `reset()`。
6. 导出：`defaultEdges`（路径）、`buildNeighbors`、`maxDegree`、`isConnected`、`isSimpleUndirected`、`paletteSizeForRound(delta,r,n)`。
7. `Rng`：`nextInt(): number`；提供 `SeqRng`。
8. 禁真实网络/DB/`setTimeout`/`Math.random`。可注入 `VirtualClock`。

构造：`new Linial({ clock, rng, processCount=5, edges?, maxRounds? })`。
- `n<1`、非简单无向、不连通 → `InvalidConfigError`。

模块：`clock` / `rng` / `types` / `errors` / `graph` / `process` / `linial` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
