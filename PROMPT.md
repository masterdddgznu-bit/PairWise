请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **FloodMax 领袖选举** 任务：n 个进程构成连通无向图，各有唯一 `uid`。`start()` 让所有 online 节点向邻居洪水自己的 uid；节点收到更大值则更新 `maxKnown` 并向**所有邻居**继续洪水该值；收敛后全体 `maxKnown` 等于全局最大 uid，该 uid 对应节点为领袖。`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以消息队列为准）。

语义约束（测试会覆盖）：
- 构造：`new FloodMax({ clock, processCount=4, edges?, uids? })`。未给 `edges` 且 n=4 时默认 `[[0,1],[1,2],[2,3],[0,3]]`（环）。未给 `uids` 时为 `0..n-1`。`processCount<2`、edges 不能构成连通无向简单图（恰好合法端点、无自环；允许 |E|≠n-1 的有环连通图）、uids 非法 → `InvalidConfigError`。
- 导出 `defaultEdges(4)`、`defaultUids(n)`、`buildNeighbors(n, edges)`（邻接表，每行邻居升序）、`isConnected(n, edges)`。
- 初始：全部 online；每进程 `maxKnown=uids[id]`；`done=false`；inbox 空。
- `start()`：若已有进行中的洪水（任一进程 inbox 非空，或已 start 过且尚未 `converged`）→ `BusyError`。向每个 **online** 进程的**每个 online 邻居** inbox 追加 `{ kind:"FLOOD", value:uids[sender], from:sender, msgId }`（每个投递一个新 msgId）。返回本次发出的消息条数。不立即处理。允许在 `converged` 之后再次 `start()`（先把各进程 `maxKnown` 重置为自身 uid，`done` 无关）。
- `step(id)`：offline → `OfflineError`；inbox 空 → false。取队头 FLOOD：
  - 若 `value > maxKnown`：`maxKnown=value`；向所有 **online 邻居**（含来源）各发一条 FLOOD(value)（新 msgId，from=id）；
  - 若 `value === maxKnown` 或 `value < maxKnown`：忽略（不转发）。
  返回 true。
- `pump(to?)`：指定 to 则反复 step；否则轮转 online 直到一轮无进展。
- `converged()`：所有 **online** 进程的 `maxKnown` 相同，且所有 online 的 inbox 皆空。
- `maxOf(id)` / `uidOf(id)` / `leaderUid()`：若 `converged()` 则返回该共同 maxKnown，否则 `null`
- `leaderId()`：若 `leaderUid()` 非 null，返回 uid 等于该值的进程下标；否则 `null`
- `isLeader(id)`：`uidOf(id)===leaderUid()` 且已 converged
- `neighborsOf(id)` / `inboxSize(id)` / `setOnline` / `isOnline`
- 向 offline 邻居：**不**投递（skip）。`start`/`step` 对 offline 进程：start 跳过该发送者；step 抛 `OfflineError`。`pump` 跳过 offline。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/graph.ts` — defaultEdges / buildNeighbors / isConnected / defaultUids
- `src/process.ts` — 单进程状态
- `src/floodmax.ts` — `FloodMax` 门面
- `src/index.ts` — 统一导出

对外 API 以 `FloodMax` / `VirtualClock` / graph 工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
