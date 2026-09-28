请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **令牌环互斥** 任务：节点按 id 环序 `0→1→…→n-1→0`；令牌沿**下一个在线**后继传递；持有令牌且 `wantEnter` 时可进入临界区；`exit` 离开并继续传牌；`tick` 推进 VirtualClock，若超过 `tokenTimeout` 无人持牌/在 CS 则由最小在线 id 重生令牌。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。

语义约束（测试会覆盖）：
- 构造：`new TokenRing({ clock, nodeCount=4, tokenTimeout=10 })`；节点 id `0 .. nodeCount-1`；初始全部 online；**令牌最初在 id 0**；无人在 CS；`wantEnter` 全 false；`lastTokenAt = 0`
- 环后继：`nextOnline(id)` = 从 `id+1` 起沿环找第一个 online（可回到自己；若仅自己 online 则后继为自己）
- `request(id)`：节点须 online，否则 `OfflineError`；标记 `wantEnter=true`；若当前持有令牌且不在 CS，则立即进入 CS（`holding`）；否则等待令牌到来
- `exit(id)`：仅在 CS 可 exit，否则 `InvalidStateError`；离开 CS，`wantEnter=false`；将令牌传给 `nextOnline(id)`（若后继是自己且仍 wantEnter 可再次进入——测试不强制；默认传出后自己不再持牌，除非后继为自己则自己继续持牌但不在 CS，除非又 request）
- 收到令牌：更新 `lastTokenAt=now`；持牌；若 `wantEnter` 则进入 CS，否则**保持持牌**（不自动空转转发；由 `pass`/`exit` 再传）
- `pass()`：若存在持牌且**不在 CS** 的节点，令其把令牌传给后继（用于测试主动空转一圈）；若在 CS 则抛 `InvalidStateError`（临界区中不可空转传牌）
- `tick()`：`clock.advance(1)`；若 `now - lastTokenAt >= tokenTimeout` 且当前**没有任何** online 节点持牌或在 CS（令牌丢失：例如持牌者已 offline 且未交接），则令牌重生到**当前最小 online id**，`lastTokenAt=now`；若该节点 `wantEnter` 则进入 CS
- `setOnline(id, online)`：
  - 下线：若该节点在 CS 或持牌，视为令牌丢失（清除其持牌/CS/`wantEnter`）；不自动重生（等 timeout）
  - 上线：不自动得牌
- `state(id)`：`idle|waiting|holding`（waiting=wantEnter 且未在 CS；holding=在 CS）
- `hasToken(id)` / `tokenHolder()`：当前持牌 online 节点 id，若无则 `null`
- `inCs()`：当前在 CS 的节点 id，若无则 `null`（互斥：至多一个）
- `isOnline(id)`

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 状态类型
- `src/errors.ts` — 错误类型
- `src/ring.ts` — nextOnline 等环辅助
- `src/node.ts` — 单节点状态
- `src/tokenring.ts` — `TokenRing` 门面
- `src/index.ts` — 统一导出

对外 API 以 `TokenRing` / `VirtualClock` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
