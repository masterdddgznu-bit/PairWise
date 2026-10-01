请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Huang 权重抛掷（Weight Throwing）终止检测** 任务：n 个进程构成连通无向图，`rootId` 为发起者。权重用**正整数**表示（避免浮点），总和恒为 `totalWeight`（2 的幂，默认 64）。

消息：
- `{ kind:"MSG"; weight: number; from: number; msgId: string }`
- `{ kind:"RETURN"; weight: number; from: number; msgId: string }`（直接寄给 root）

语义：
1. `start()`：root `active=true`，`weight=totalWeight`；其余 `active=false`，`weight=0`。重复 start → `BusyError`。
2. `send(from, to)`：`from` 须 `active` 且为邻居；`from.weight` 须 `>= 2`（否则 `InvalidConfigError`）。令 `give = floor(weight/2)`，`from.weight -= give`，向 `to` 发 MSG(give)。未 start → `BusyError`。
3. `step(id)`：
   - **MSG**：`weight += msg.weight`，`active=true`。
   - **RETURN**：仅 root 应收到；`weight += msg.weight`，然后 `tryTerminate()`。非 root 收到 RETURN → `InvalidConfigError`。
4. `localDone(id)`：`active=false`。若 `id !== root` 且 `weight>0`：向 root 发 RETURN(weight)，本地 `weight=0`。若为 root：`tryTerminate()`。未 start 的节点调用 → `BusyError`（root 未 start 同样）。
5. `tryTerminate()`：若 root `!active` 且 `weight === totalWeight` → `terminated=true`。
6. 守恒：任意时刻全体 `weight` + 在途 MSG/RETURN 的 weight 之和 = `totalWeight`。
7. `pump` / `weightOf` / `isActive` / `terminated` / `totalWeight()` / `rootId()` / `neighborsOf` / `inboxSize` / `reset()`。
8. 不要求上下线。禁真实网络/DB/`setTimeout`。可注入 `VirtualClock`。

构造：`new WThrow({ clock, processCount=5, edges?, rootId=0, totalWeight=64 })`。`totalWeight` 须为 `>=2` 的 2 的幂；默认边为线 `[[0,1],[1,2],[2,3],[3,4]]`。非法配置 → `InvalidConfigError`。

导出：`defaultEdges`、`buildNeighbors`、`isConnected`、`isPowerOfTwo`。

模块：`clock` / `types` / `errors` / `graph` / `process` / `wthrow` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
