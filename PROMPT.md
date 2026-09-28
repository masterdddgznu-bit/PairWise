请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Ricart–Agrawala 分布式互斥** 任务：多节点用 Lamport 逻辑钟发 REQUEST；收到 REQUEST 时若自己未请求/未持锁或对方优先级更高则立即 REPLY，否则延迟；凑齐全部**当前在线且发起时在线**的其他节点 REPLY 后进入临界区；`exit` 释放并补发延迟 REPLY；`setOnline` 模拟分区。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以逻辑钟为主，墙钟可不推进）。

语义约束（测试会覆盖）：
- 构造：`new Ricart({ clock, nodeCount=3 })`；节点 id `0 .. nodeCount-1`，全部初始 online、clock=0、不在 CS、无 pending request
- Lamport：本地事件 `clock = clock+1`；收消息 `clock = max(clock, msg.clock)+1`
- `request(id)`：若已在 CS 或已有未完成请求则抛 `InvalidStateError`；若节点离线抛 `OfflineError`；分配递增 `opId`（全局 `"1"`,`"2"`,…）；节点 `clock++`，记录 `reqClock=clock`，状态 `waiting`；向**除自己外所有当时 online** 的节点发 REQUEST`(reqClock, id)`；若当时没有其他 online 节点，则直接 `holding`
- 收到 REQUEST`(ts, from)`（接收方须 online）：先做 Lamport 更新；若接收方 **idle**，立即 REPLY；若 **holding**，一律延迟；若 **waiting**：比较 `(ts, from)` 与自己的 `(reqClock, id)`（先比 ts，再比 from id，更小者优先）；若对方优先则立即 REPLY，否则把 from 记入 deferred 集合
- 收到 REPLY：计入；当已收到「发起 request 时目标集合」中仍需的全部 REPLY（离线后不可达的节点：见下）→ `holding`
- `setOnline(id, online)`：
  - 下线：从其他节点视角该节点不再收发；若某节点正在 waiting 且目标里包含该节点，则把该节点从「仍需 REPLY」集合移除（等价于不再等待它）；若下线节点自己在 waiting/holding，保持其本地状态但无法与外界交互
  - 上线：可重新参与后续 request；不自动清空他人 deferred
- `exit(id)`：仅 `holding` 可 exit，否则 `InvalidStateError`；退出 CS；对 deferred 中每个仍 online 的节点发 REPLY 并清空 deferred；状态回到 idle
- `state(id)`：`idle|waiting|holding`
- `clockOf(id)` / `isOnline(id)` / `deferred(id)`（返回 id 数组，升序）
- `status(opId)`：`waiting|holding|done|unknown`（exit 后该次请求为 done）
- `holder()`：若恰有一个 holding 返回其 id，否则 `null`（互斥：任何时刻至多一个 holding——在全部 online 且无分区的完整运行下由算法保证；测试会在连通情况下检查）

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 状态类型
- `src/errors.ts` — 错误类型
- `src/lamport.ts` — 逻辑钟比较/更新辅助
- `src/node.ts` — 单节点状态
- `src/ricart.ts` — `Ricart` 门面
- `src/index.ts` — 统一导出

对外 API 以 `Ricart` / `VirtualClock` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
