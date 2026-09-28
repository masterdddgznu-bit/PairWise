请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **ABD 原子寄存器** 任务：多副本；写分两阶段（多数派查询最大时间戳 → 多数派写入新时间戳）；读分两阶段（多数派查询 → 把最大值写回多数派）；时间戳为 `(num, writerId)` 字典序；`setOnline` 模拟分区，离线副本不参与 quorum。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可用注入的 `VirtualClock` 仅作可选计数（本协议逻辑时间戳不依赖墙钟）；不要用真实 sleep。

语义约束（测试会覆盖）：
- 构造：`new AbdReg({ clock, replicaCount=3 })`；replica id 为 `0 .. replicaCount-1`；majority = `floor(n/2)+1`（相对配置全集群）
- 每副本存 `{ value: string | null, ts: Timestamp }`，初始 `value=null`，`ts={num:0, writerId:0}`
- `Timestamp` 比较：先比 `num`，再比 `writerId`（更大者更新）
- `beginWrite(writerId, value)`：`writerId` 必须是合法 replica id；`value` 为空串抛 `InvalidValueError`；分配 opId（`"w1"`,`"w2"`,…）；状态 `pending`；**不在 begin 内自动完成**（需 `step`/`pump`）
- `beginRead()`：分配 opId（`"r1"`,`"r2"`,…）；pending
- `step()`：每个 pending 操作至多推进一个阶段；返回是否有进展；`blocked` 操作本轮不自动重试
- `pump()`：反复 `step` 直到无进展
- 写阶段：
  1. `query`：向所有**在线**副本收集 store；若在线回复数 `< majority` 则本阶段失败，操作变 `blocked`（须在 `setOnline` 之后才会被重新标为 `pending`，再 `pump` 从当前阶段重试）
  2. 取最大 ts，令 `newTs={num:max.num+1, writerId}`，进入 `write` 阶段
  3. `write`：向在线副本写入 `{value, ts:newTs}`；回复数 ≥ majority → `done`，记录 `resultValue=value`
- 读阶段：
  1. `query`：同上收集；取最大 ts 的 value（若全是初始 ts 且 value null，则结果为 `null`）
  2. `writeback`：把该 `{value,ts}` 写到在线多数 → `done`，`resultValue` 为读到的值
- `status(opId)`：`pending|blocked|done|unknown`
- `result(opId)`：仅 `done` 时返回 value（读可能为 `null`），否则抛 `NotDoneError`
- `local(id)`：返回该副本当前 `{value, ts}`
- `setOnline(id, online)`：离线不参与收发；将所有 `blocked` 操作改回 `pending` 以便重试
- 并发：多个 pending 写按 `step` 轮转推进；时间戳必须让后完成的写具有更大 ts（通过 query 见到已写入的最大值）
- `majorityOf` / `hasQuorum` / `cmpTs` / `maxTs` 导出

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — Timestamp / Op 状态等
- `src/errors.ts` — 错误类型
- `src/quorum.ts` — majority / hasQuorum
- `src/timestamp.ts` — cmpTs / maxTs
- `src/replica.ts` — 单副本存储
- `src/op.ts` — 读写操作状态
- `src/abdreg.ts` — `AbdReg` 门面
- `src/index.ts` — 统一导出

对外 API 以 `AbdReg` / `VirtualClock` / 错误类型 / 时间戳与 quorum 工具为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
