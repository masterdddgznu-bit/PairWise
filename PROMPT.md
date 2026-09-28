请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Raymond 树令牌互斥** 任务：n 个进程组成无向树；每进程有父指针指向令牌所在方向（持有者 `parent===self`）；`request(i)` 把自己入本地请求队列，必要时向父发 REQUEST；收到 REQUEST 则入队并视情况向上要令牌或向下发 TOKEN；持有令牌且队头是自己则进入临界区；`release(i)` 后把令牌交给队头并更新父指针。`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以消息队列为准）。

语义约束（测试会覆盖）：
- 构造：`new Raymond({ clock, processCount=3, edges? })`。默认 n=3 且未给 edges 时树为 `[[0,1],[0,2]]`（0 为根）。初始进程 0 持有令牌：`parent[0]=0`，`parent[1]=0`，`parent[2]=0`；其余 idle；请求队列空；inbox 空。`processCount<2` 或 edges 不能构成连通树（恰好 n-1 条边、无环、端点合法）→ `InvalidConfigError`。
- 导出 `defaultEdges(3)` → `[[0,1],[0,2]]`；`buildNeighbors(n, edges)` → 邻接表（每行邻居升序）。
- `request(id)`：非法 id → `InvalidProcessError`；offline → `OfflineError`；状态不是 idle → `BusyError`。若 `parent===id`（持有令牌）则状态 `held`，分配并返回 msgId（不发消息）。否则：把 `id` 追加到本进程请求队列；状态 `waiting`；**若入队前队列为空**则向 `parent` 的 inbox 追加 `{ kind:"REQUEST", from:id, msgId }`（仅当 parent online；若 parent offline 仍写入其 inbox）。返回 msgId。全局 msgId 递增 `"1"`,`"2"`,…。不立即处理 inbox。
- `release(id)`：非 `held` → `NotHolderError`；offline → `OfflineError`。状态回到 idle。若请求队列非空：出队头 `k`；若 `k===id`（自己又排在队头——本实现 release 时不应发生，若发生则再次 held）；否则：把令牌发给 `k`（TOKEN 写入 k 的 inbox，本进程 `parent=k`，不再持有），若出队后队列仍非空则再向新 parent `k` 发 REQUEST。若队列空则继续持有（`parent` 仍为 self）。返回新 msgId。
- `step(id)`：offline → `OfflineError`。inbox 空 → false。否则取队头：
  - REQUEST from `j`：把 `j` 追加到请求队列（若已在队列中则忽略重复）。若本进程持有令牌且状态为 `idle`：出队头 `k`，若 `k===id` 则状态 `held`；否则发 TOKEN 给 `k`，`parent=k`，若队列仍非空则向 `k` 发 REQUEST。若**不持有**令牌且入队后队列长度为 1（即这是唯一请求）：向当前 `parent` 发 REQUEST。返回 true。
  - TOKEN：本进程成为持有者（`parent=id`）。出队头 `k`（队列必非空，否则忽略令牌并保持持有 idle）。若 `k===id` 则状态 `held`；否则发 TOKEN 给 `k`，`parent=k`，若队列仍非空则向 `k` 发 REQUEST。若原状态为 waiting 且 `k===id` 则变为 held。返回 true。
- `pump(to?)`：指定 to 则反复 `step(to)` 直到 false；否则轮转所有 online 进程直到一轮无人进展。
- `stateOf(id)` / `parentOf(id)` / `hasToken(id)`（`parent===id`）/ `holder()`（持有者 id，令牌在途则 `null`）/ `queueOf(id)`（请求队列拷贝）/ `neighborsOf(id)` / `inboxSize(id)` / `setOnline` / `isOnline`。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息与状态类型
- `src/errors.ts` — 错误类型
- `src/tree.ts` — `defaultEdges` / `buildNeighbors` / 校验
- `src/process.ts` — 单进程状态
- `src/raymond.ts` — `Raymond` 门面
- `src/index.ts` — 统一导出

对外 API 以 `Raymond` / `VirtualClock` / `defaultEdges` / `buildNeighbors` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
