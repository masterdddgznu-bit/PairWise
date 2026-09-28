请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **链式复制（Chain Replication）** 任务：配置顺序的副本链；写从 Head 进入并沿后继转发，到达 Tail 后提交；读只从 Tail；`setOnline` 使节点离线后须重配活跃链（跳过离线节点）；进行中的写用 `step`/`pump` 推进。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议可不依赖墙钟推进，但须保留该类型）。

语义约束（测试会覆盖）：
- 构造：`new ChainRep({ clock, replicaCount=4 })`；配置 id 为 `0 .. replicaCount-1`，配置序即链序
- 活跃链 = 配置序中所有 `online===true` 的节点；Head = 活跃链首，Tail = 活跃链尾；活跃链长度须 ≥ 1，否则写/读抛 `NoQuorumError`（无可用副本）
- 每副本存 `value: string | null`（初始 null）与已接受的 `seq`（初始 0）
- `beginWrite(value)`：value 为空抛 `InvalidValueError`；若无 Head 抛 `NoQuorumError`；分配 opId `"w1"`,`"w2"`,… 与全局递增 `seq`；在 Head 放入 pending 转发状态；**不在 begin 内自动传完全链**
- `step()`：对每个未完成写，若当前持有节点在线且有后继，则把 `(seq,value)` 交给后继并前进一跳；若当前节点已是 Tail，则标记该写 `done` 并更新 Tail 的提交值；若持有节点离线，则操作变 `blocked`（重配后可从新 Head/中途恢复——见下）
- `pump()`：反复 `step` 直到无进展
- 重配：`setOnline(id,online)` 更新在线位并重算 Head/Tail；所有 `blocked` 改回 `pending`；对仍 `pending`/`blocked` 的写：若其 `seq` 已在当前 Tail 提交（或任意在线节点已持有该 seq 的值且该节点是当前活跃链上不早于「最高已持有位置」），须把持有位置调整到**当前活跃链上仍持有该 seq 的最靠前节点**；若没有任何在线节点持有该 seq，则把写重新挂到当前 Head（Head 接受该 seq/value）
- `status(opId)`：`pending|blocked|done|unknown`
- `result(opId)`：仅 `done` 返回 value，否则 `NotDoneError`
- `read()`：返回当前 Tail 的提交值（`null` 若尚未有提交）；无 Tail 抛 `NoQuorumError`
- `headId()` / `tailId()`：当前活跃链首/尾，若无在线节点则为 `null`
- `local(id)`：`{ value, seq, online }`
- `chain()`：返回当前活跃链 id 数组（配置序）

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 状态类型
- `src/errors.ts` — 错误类型
- `src/replica.ts` — 单副本
- `src/op.ts` — 写操作状态
- `src/chain.ts` — 活跃链计算
- `src/chainrep.ts` — `ChainRep` 门面
- `src/index.ts` — 统一导出

对外 API 以 `ChainRep` / `VirtualClock` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
