请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Beta 同步器（Beta Synchronizer）** 任务：n 个进程构成一棵**有根树**（连通无环，指定 `rootId`）。每个 online 节点维护 `pulse`（初始 0）。一轮推进：
1. **UP**：叶子（无 online 子节点）向 parent 发 `{ kind:"UP", pulse, from, msgId }`；内部节点收齐所有 online 子节点的同号 UP 后，向 parent 发 UP（root 不向 parent 发）。
2. **DOWN**：root 在收齐全部 online 子节点的 UP（若 root 为叶子则无需等待）后，自身 `pulse+=1`，并向每个 online 子节点发 `{ kind:"DOWN", pulse:新脉冲, from, msgId }`；非 root 收到 DOWN 后 `pulse` 设为消息中的值，清空本轮 UP 记录，并向 online 子节点转发 DOWN。

`begin()` 启动当前脉冲的 UP（对所有尚未发送本轮 UP 的 online 叶子发送）。`setOnline` 控制谁参与；online 导出子图相对 root 仍须为树。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`。

语义约束（测试会覆盖）：
- 构造：`new BetaSync({ clock, processCount=4, edges?, rootId=0 })`。未给 `edges` 且 n=4 时默认线树 `[[0,1],[1,2],[2,3]]`。`processCount<2`、edges 不是树、`rootId` 非法 → `InvalidConfigError`。
- 导出 `defaultEdges(4)`、`buildNeighbors`、`isConnected`、`isTree`、以及 `orientTree(n, edges, rootId)` → `{ parent: (number|null)[], children: number[][] }`（children 每行升序；root 的 parent 为 null）。
- 初始：全部 online；pulse=0；upRecv 空；upSent=false；inbox 空。
- `reset()`：全体恢复初始。
- `begin()`：若存在 online 节点已 `upSent` 且尚未完成本轮（未因 DOWN 清空）→ `BusyError`。校验 online 导出子图是树且 root online，否则 `InvalidConfigError`。对每个 online 且 online 子节点数为 0 的叶子：向 parent 发 UP(当前 pulse)（若为 root 叶子则直接执行 root 收齐逻辑：root `pulse+=1` 并 DOWN 给子节点——无子则只 +1）。置叶子 `upSent=true`。返回发出 UP/DOWN 总条数。
- `step(id)`：offline → `OfflineError`；空 → false。
  - **UP**：仅当 `msg.pulse===pulse` 时记入 `upRecv`；若已收齐全部 online 子节点的 UP：若是 root 则 `pulse+=1`，清空 upRecv/upSent，向每个 online 子发 DOWN(新 pulse)；否则向 parent 发 UP(pulse) 并 `upSent=true`。
  - **DOWN**：设 `pulse=msg.pulse`；清空 upRecv、upSent=false；向每个 online 子转发 DOWN(msg.pulse)。
  返回 true。忽略错误脉冲号的 UP（仍消费）。
- `pump(to?)` / `pulseOf` / `minPulse`（online 最小）/ `maxPulse` / `synced()`（online 同 pulse、inbox 空、全体 `upSent===false`）
- `barrier(target)`：当 `minPulse()<target` 时循环 `begin()+pump`，直到达到或卡住；`target<0` → `InvalidConfigError`。返回 `minPulse()`。
- `rootId()` / `parentOf(id)` / `childrenOf(id)`（静态树定向，含 offline 子下标仍返回结构上的 children，但收发只用 online）
- `neighborsOf` / `inboxSize` / `setOnline` / `isOnline`
- 任一节点 `upSent===true` 时 `setOnline` → `BusyError`。向 offline 不投递。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/graph.ts` — defaultEdges / buildNeighbors / isConnected / isTree / orientTree
- `src/process.ts` — 单进程状态
- `src/betasync.ts` — `BetaSync` 门面
- `src/index.ts` — 统一导出

对外 API 以 `BetaSync` / `VirtualClock` / graph 工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
