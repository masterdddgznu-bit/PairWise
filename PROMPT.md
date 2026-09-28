请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Suzuki–Kasami 令牌互斥** 任务：n 个进程，初始由进程 0 持有令牌。每进程有 `RN[n]`（见过的各进程请求序号）；令牌含 `LN[n]` 与 FIFO 队列 `Q`。`request(i)` 递增 `RN[i][i]`；若已持令牌则立即进入，否则向其他在线进程广播 REQUEST；收到 REQUEST 后更新 RN，若本进程持令牌且不在临界区且对方请求未满足则把令牌发给对方；`release(i)` 更新 LN、把待满足请求入队并转发令牌给队头。`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以请求序号为准）。

语义约束（测试会覆盖）：
- 构造：`new Suzuk({ clock, processCount=3 })`；进程 id `0 .. n-1`；全部 online；状态 idle；RN 全 0；inbox 空。初始 **进程 0 持有令牌**（`LN` 全 0、`Q` 空），其余不持有。`processCount < 2` 抛 `InvalidConfigError`。
- `request(id)`：非法 id → `InvalidProcessError`；offline → `OfflineError`；状态不是 idle → `BusyError`。执行 `RN[id][id] += 1`；若当前持有令牌则状态变为 `held`（不发消息）；否则状态 `waiting`，向**除自己外所有当时 online** 的进程 inbox 追加 `{ kind:"REQUEST", from:id, seq:RN[id][id], msgId }`。`msgId` 全局递增字符串 `"1"`,`"2"`,…。**不立即处理 inbox**。返回 `msgId`（已持令牌直接进入时也分配并返回一个 msgId，但不投递消息）。
- `release(id)`：非 `held` → `NotHolderError`；offline → `OfflineError`。令 `LN[id] = RN[id][id]`；对每个 `j≠id`，若 `RN[id][j] === LN[j] + 1` 且 `j` 不在 Q 中则把 `j` 入队尾；状态回到 idle。若 Q 非空：出队头 `k`，把令牌（含当前 LN 与剩余 Q 的拷贝）发到 `k` 的 inbox 为 `{ kind:"TOKEN", from:id, ln, queue, msgId }`，本进程不再持有令牌；若 `k` 当时 online 则投递，若 offline 则仍投递到其 inbox（保留，上线后可 step）。若 Q 空则继续持有令牌。返回新 msgId。
- `step(id)`：offline → `OfflineError`。inbox 空 → false。否则取队头：
  - REQUEST：令 `RN[id][from] = max(RN[id][from], seq)`。若本进程**持有令牌**且状态为 `idle` 且 `RN[id][from] === LN[from] + 1`，则把令牌发给 `from`（TOKEN 消息，Q 原样拷贝；本进程不再持有）。返回 true。
  - TOKEN：本进程成为持有者（保存 ln/queue）；若状态为 `waiting` 则变为 `held`；若为 idle 则保持 idle 并持有令牌。返回 true。
- `pump(to?)`：指定 to 则反复 `step(to)` 直到 false；否则轮转所有 online 进程直到一轮无人进展。
- `stateOf(id)`：`"idle" | "waiting" | "held"`
- `holder()`：当前持有令牌的进程 id；若令牌在途（已发出未 step 送达）返回 `null`
- `hasToken(id)`：该进程是否本地持有令牌
- `rnOf(id)`：RN 数组拷贝
- `tokenLn()` / `tokenQueue()`：若存在本地持有者则返回其令牌 LN 拷贝 / Q 拷贝；否则 `null` / `null`
- `inboxSize(id)` / `setOnline(id, online)` / `isOnline(id)`：下线后 `request`/`release`/`step` 抛 `OfflineError`；`pump()` 跳过；inbox/RN/令牌状态保留。向 offline 进程广播 REQUEST 时**跳过**（与向量广播一致）；但 release/转发 TOKEN 时若目标 offline 仍写入其 inbox。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息与状态类型
- `src/errors.ts` — 错误类型
- `src/token.ts` — `Token`（ln + queue）
- `src/process.ts` — 单进程状态
- `src/suzuk.ts` — `Suzuk` 门面
- `src/index.ts` — 统一导出

对外 API 以 `Suzuk` / `VirtualClock` / `Token` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
