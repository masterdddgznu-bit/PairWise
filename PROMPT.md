请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Alpha 同步器（Alpha Synchronizer）** 任务：n 个进程构成连通无向图。每个 online 节点维护非负整数 `pulse`（初始 0）。`emit(id)` 将当前 `pulse` 作为 `{ kind:"PULSE", pulse, from, msgId }` 发给所有 **online 邻居**（每个邻居一条新 msgId），并标记本脉冲已发出；同一脉冲重复 `emit` → `BusyError`。`step(id)` 取队头 PULSE：仅当 `msg.pulse === 本节点当前 pulse` 时记入本脉冲的 `recv`；若本脉冲已 `emit` 且已收到全部 online 邻居的同号 PULSE，则 `pulse += 1`，清空本脉冲的 `emitted/recv`。忽略 `msg.pulse !== 当前 pulse` 的过期/超前消息（仍消费队头并返回 true）。`setOnline` 控制邻居集合。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以消息队列为准）。

语义约束（测试会覆盖）：
- 构造：`new AlphaSync({ clock, processCount=4, edges? })`。未给 `edges` 且 n=4 时默认环 `[[0,1],[1,2],[2,3],[0,3]]`。`processCount<2`、edges 不能构成连通无向简单图 → `InvalidConfigError`。
- 导出 `defaultEdges(4)`、`buildNeighbors(n, edges)`（邻接表升序）、`isConnected(n, edges)`。
- 初始：全部 online；`pulse=0`；未 emit；recv 空；inbox 空。
- `reset()`：将全体恢复初始（可在任意时刻调用）；清空 started 语义上允许重新跑。`reset` 后 `minPulse()===0`。
- `emit(id)`：非法 id → `InvalidProcessError`；offline → `OfflineError`；若该节点对本脉冲已 emit → `BusyError`。向每个 online 邻居发 PULSE(当前 pulse)；无 online 邻居时仍标记 emitted，并在 step 条件满足时（recv 空集已齐）可在下一次相关路径晋升——约定：emit 后若 online 邻居数为 0，则立即 `pulse+=1` 并清除 emitted（孤立 online 节点可独自推进）。返回发出条数。
- `step(id)`：offline → `OfflineError`；空 → false。处理队头如上。返回 true。
- `pump(to?)`：指定 to 则反复 step；否则轮转 online 直到一轮无进展。
- `pulseOf(id)` / `minPulse()`（全体 online 的最小 pulse；无 online 则 0）/ `maxPulse()`
- `barrier(targetPulse)`：反复「对所有尚未达到 target 的 online 节点 emit（若尚未 emit 当前脉冲），再 pump」，直到 `minPulse()>=targetPulse` 或无法进展；若 `targetPulse<0` → `InvalidConfigError`。返回最终 `minPulse()`。
- `synced()`：所有 online 的 pulse 相同，且所有 online inbox 空，且没有任何 online 处于「已 emit 当前脉冲但尚未晋升」的等待态（即要么都未 emit 当前脉冲，要么…简化：`synced` 当且仅当 online 脉冲相同且 inbox 全空且全体 `emitted===false`）。
- `neighborsOf` / `inboxSize` / `setOnline` / `isOnline`
- 向 offline：**不**投递。`pump` 跳过 offline。`setOnline` 在某节点 `emitted===true`（等待本脉冲邻居）时调用 → `BusyError`；其他时候可改，改完后邻居集合以新 online 为准（已发出的消息不撤回）。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/graph.ts` — defaultEdges / buildNeighbors / isConnected
- `src/process.ts` — 单进程状态
- `src/alphasync.ts` — `AlphaSync` 门面
- `src/index.ts` — 统一导出

对外 API 以 `AlphaSync` / `VirtualClock` / graph 工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
