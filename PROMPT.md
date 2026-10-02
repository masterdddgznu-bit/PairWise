请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Kuhn–Wattenhofer 确定性颜色归约** 教学简化版：n 个顶点（id `0..n-1`），无向简单连通图由 `edges` 给出。全过程确定性，不使用任何随机数。

记 `Δ = maxDegree(graph)`，目标色数 `T = Δ + 1`，桶大小 `B = 2T`。

消息（沿边双向投递）：
- `{ kind:"COLOR"; from: number; color: number; round: number; step: number }`

顶点状态：当前 `color`、邻居最新已知色（由 COLOR 消息维护）、inbox。

语义：
1. `start()`：`color(i)=i`，调色板上界 `m = n`，`roundIndex = 0`；向邻居广播 `COLOR` 并 `pump()`。重复 → `BusyError`。未 start 调 `reduceRound()` → `BusyError`。
2. `reduceRound()`：
   - 若 `m <= T`：不做任何事，返回 `false`。
   - 否则：每个顶点颜色 `c` 归属桶 `b = floor(c / B)`，桶内局部色 `l = c % B`。
   - 局部色 `l < T` 的顶点保持局部色不变。
   - 对 `l = T, T+1, …, B-1` **依次**处理（每个 l 是一个 step）：所有局部色为 `l` 的顶点**同时**在 `[0, T)` 中选**最小**的、不等于任何**同桶**邻居当前局部色的值，作为新局部色。每个 step 结束后广播 `COLOR` 并 `pump()`，使下一个 step 看到最新邻色。不同桶的邻居不参与冲突判断。
   - 全部 step 完成后，每个顶点新颜色 `= b * T + 新局部色`（b 为本轮开始时所属桶）。
   - `m = ceil(m / B) * T`，`roundIndex++`，广播 `COLOR` 并 `pump()`，返回 `true`。
3. `run()`：未 start 则先 `start()`，然后反复 `reduceRound()` 直到返回 `false`。结束后必须 `isProper()` 且 `maxColor() <= Δ`。
4. 查询：`colorOf` / `colors()`（按 id 顺序）/ `neighborsOf`（升序）/ `delta()` / `target()`（=T）/ `paletteBound()`（=m，未 start 时为 n）/ `roundIndex()` / `isProper()` / `maxColor()` / `phase()`：
   - `idle`：未 start
   - `running`：已 start 且 `m > T`
   - `done`：已 start 且 `m <= T`
5. `step(id)`：投递该点 inbox 一条（若有）；`pump()`：直到所有 inbox 空；`inboxSize`；`reset()` 回 idle。
6. 导出：`defaultEdges`（路径）、`buildNeighbors`、`maxDegree`、`isConnected`、`isSimpleUndirected`、`binSize(delta)`（=2(Δ+1)）、`nextPaletteBound(m, delta)`（=ceil(m/B)*T）。
7. 禁真实网络/DB/`setTimeout`/`Math.random`。可注入 `VirtualClock`。

构造：`new KWColor({ clock, processCount=5, edges? })`。
- `n<1`、非简单无向、不连通 → `InvalidConfigError`。

模块：`clock` / `types` / `errors` / `graph` / `process` / `kwcolor` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
