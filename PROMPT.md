请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Israeli–Itai 极大匹配** 教学简化版：n 个顶点（id `0..n-1`），无向简单连通图由 `edges` 给出。随机性只来自注入 `Rng`（禁止 `Math.random`）。

消息（沿边）：
- `{ kind:"PROPOSE"; from: number; to: number; msgId: string }` — 空闲顶点向选中的邻居提议匹配
- `{ kind:"ACCEPT"; from: number; to: number; msgId: string }` — 接受提议
- `{ kind:"REJECT"; from: number; to: number; msgId: string }` — 拒绝提议

顶点状态：`free`（未匹配）、`mate: number | null`、本轮是否已提议。

语义：
1. `start()`：全部 `free=true`，`mate=null`。重复 → `BusyError`。
2. 每一轮 `round()`（若已无 free 顶点或无法再推进则返回 false）：
   - **提议**：每个仍 `free` 的顶点，若有至少一个仍 `free` 的邻居：用 `rng.nextInt()` 在这些邻居中按「`nextInt() % k`」选一个目标（k=候选数），向其发 `PROPOSE`。若无 free 邻居则本轮不提议。
   - `pump()` 投递消息。
   - **响应**：每个收到 ≥1 条 PROPOSE 且自身仍 free 的顶点：在 proposers 中选 id **最小**者发 `ACCEPT`，对其余发 `REJECT`。若自身已不 free，对所有 PROPOSE 回 `REJECT`。
   - `pump()`。
   - **确认**：若 v 发出的 PROPOSE 收到对应 `ACCEPT`（from=目标,to=v），则双方匹配：`mate` 互指，`free=false`。`REJECT` 则保持 free。
3. `run()`：反复 `round()` 直到返回 false。
4. `step` / `pump`、`isFree` / `mateOf` / `matching(): [number,number][]`（每条边以 `[min,max]` 表示并按字典序排序，无重复）、`isMatching()` / `isMaximal()` / `neighborsOf` / `inboxSize` / `reset()`。
5. 导出：`defaultEdges`（路径）、`buildNeighbors`、`isConnected`、`isSimpleUndirected`。
6. `Rng`：`nextInt(): number`。提供 `SeqRng`。
7. 禁真实网络/DB/`setTimeout`/`Math.random`。可注入 `VirtualClock`。

构造：`new IIMatch({ clock, rng, processCount=5, edges? })`。
- `n<1`、非简单无向、不连通 → `InvalidConfigError`。

模块：`clock` / `rng` / `types` / `errors` / `graph` / `process` / `iimatch` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
