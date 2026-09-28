请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Bully 选主** 任务：节点 id 越大优先级越高；发起选举时向所有更高 id 的在线节点发 Election；若在超时内收到任一 OK 则等待 Coordinator；若超时无 OK 则自称 Coordinator 并广播；收到 Election 的更高节点立即回 OK 并自己发起选举；收到 Coordinator 则承认对方为领导。时间用注入的 `VirtualClock` + `tick()` 推进。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。

语义约束（测试会覆盖）：
- 构造：`new Bully({ clock, nodeCount=5, electionTimeout=5 })`；节点 id `0 .. nodeCount-1`；初始全部 online、`leader=null`、状态 `idle`
- `startElection(id)`：节点须 online，否则 `OfflineError`；若已在 `electing` 可忽略或保持（测试以最终结果为准）；向所有 `j>id` 且 online 的节点发 Election；进入 `electing`，记录 `electionDeadline = now + electionTimeout`；若没有任何更高在线节点，则立即成为 Coordinator（见下）
- 收到 Election（from 较低 id）：接收方须 online；立即向 from 发 OK；并调用自身 `startElection`（若尚未 electing/leading 则启动；若已是 leader 也要重新选举以覆盖）
- 收到 OK：若本节点 `electing`，标记 `gotOk=true`（不再因超时自称 coordinator，改为等待 Coordinator 消息；可把 deadline 再延长一轮 `now+electionTimeout` 用于等待 coordinator，或保持原 deadline——测试要求：在更高节点活着时最终必收到 Coordinator，不会自称）
- 收到 Coordinator(leaderId)：采纳 `leader=leaderId`；状态 `idle`（若自己是 leaderId 则 `leading`）；清除 electing 标记
- 成为 Coordinator：`leader=自己`，状态 `leading`，向所有其他 online 节点广播 Coordinato
- `tick()`：`clock.advance(1)`；对每个 `electing` 且 `now >= electionDeadline` 的节点：若 `gotOk===false` 则自称 Coordinator；若 `gotOk===true` 仍未收到 Coordinator，则**重新** `startElection`（再次向更高节点拉票）
- `setOnline(id, online)`：
  - 下线：若它是当前 `leader`，所有仍 online 且知此 leader 的节点将 `leader` 置 `null`（可在下线时广播“领导失效”，或仅清除自己；测试：下线 leader 后由存活节点 `startElection`/`tick` 选出新领导）；下线节点自身状态清空为 idle、leader=null
  - 上线：不自动选举；可被他人 Election/Coordinato
- `leaderOf(id)`：该节点认定的 leader（`number|null`）
- `state(id)`：`idle|electing|leading`
- `isOnline(id)` / `coordinator()`：若存在唯一 `leading` 节点返回其 id，否则 `null`

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 状态类型
- `src/errors.ts` — 错误类型
- `src/node.ts` — 单节点状态
- `src/messages.ts` — Election/OK/Coordinator 类型
- `src/bully.ts` — `Bully` 门面
- `src/index.ts` — 统一导出

对外 API 以 `Bully` / `VirtualClock` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
