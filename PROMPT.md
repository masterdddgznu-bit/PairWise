请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的无序邮箱（send / recv）。请在此基础上迭代实现向量时钟因果广播、缺口缓冲、可交付弹出、超时 repair，以及稳定点 GC，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `VecBuf`（见 `src/bus.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new VecBuf(n: number)`：`n` 个节点，id 为 `0..n-1`
- `send(from, to, payload: string): void`：把消息放入 `to` 的无序邮箱（**不**保证顺序）
- `recv(to) -> { from; payload } | null`：任意弹出一条；空则 null
- `inboxSize(to) -> number`
- 基础阶段无向量时钟、无因果、无缓冲层

## 待迭代功能

构造扩展：`new VecBuf(n, clock?: VirtualClock, opts?: { repairTimeoutMs?: number })`
- `repairTimeoutMs` 缺省 `10`

**因果广播 `broadcast(from, payload) -> CausalMessage`**
- 发送方 `from` 的本地向量时钟 `VC[from] += 1`，消息携带拷贝后的 `vc: number[]`（长度 n）与 `from`、`payload`、单调 `seq`（该 from 的发送序号，从 1 起）
- **不**自动投递到其他节点（由测试/上层调用 `receive` 模拟网络乱序与丢包）；发送方自己视为已交付（`DEL[from][from]` 跟上）
- 返回发出的消息拷贝

**接收 `receive(to, msg: CausalMessage) -> void`**
- 若 `msg` 对 `to` 已交付或已缓冲过相同 `(from, seq)`：忽略
- 否则放入该节点缺口缓冲

**因果可交付**
- 节点 `to` 维护已交付向量 `DEL[to]`（长度 n，初 0）
- 缓冲中消息 `m` 可交付当且仅当：
  - `m.vc[m.from] == DEL[to][m.from] + 1`
  - 对所有 `k != m.from`：`m.vc[k] <= DEL[to][k]`
- `deliver(to) -> CausalMessage | null`：若有可交付消息，弹出**一条**（若多条同时可交付，取 `from` 较小者，同 from 取较小 `seq`），并 `DEL[to][m.from] += 1`
- `deliverAll(to) -> CausalMessage[]`：反复 deliver 直到不可再交付，按交付顺序返回
- `buffered(to) -> number`：缺口缓冲条数
- `deliveredClock(to) -> number[]`：`DEL[to]` 拷贝

**修复**
- 对节点 `to`，若缓冲中存在消息 `m`，但其可交付条件因 `DEL[to][m.from] + 1 < m.vc[m.from]` 而缺口，则缺失序号为 `DEL[to][m.from]+1 .. m.vc[m.from]-1`（相对发送方 from）
- 更一般：`missing(to) -> { from: number; seq: number }[]`
  - 对每个发送方 `f != to`，若缓冲或已知信息显示期望下一条为 `expect = DEL[to][f]+1`，且存在缓冲消息来自 `f` 的 `seq > expect`，则所有空洞 `expect .. min(buffered seq)-1` 列入；按 `(from, seq)` 字典序
  - 仅依据**缓冲内**同 from 的最大 seq 与 DEL 推断空洞（不要求全局知识）
- `tick()`：对每个节点，若该节点缓冲非空且自上次缓冲变化或上次 repair 起已经过 `repairTimeoutMs`（用 clock），则生成 repair 请求：
  - `pendingRepairs() -> { to: number; missing: { from; seq }[] }[]`（本次 tick 新产生的，按 to 升序；消费型：读出后清空）
- 缓冲从空变为非空时记录 `bufferSince=now`；deliver 使缓冲变空则清除计时；`tick` 触发 repair 后重置计时（避免每 tick 重复），直到缓冲再次变化

**稳定 GC**
- `ack(to, clock: number[])`：节点 `to` 声明其 `DEL` 至少达到 clock（逐维 max）
- `minStableClock() -> number[]`：所有节点 ack 时钟的逐维 min（无 ack 的节点视为全 0）
- `gc()`：删除所有节点缓冲中满足「对每个节点 to，该消息已交付或 `msg.vc` 逐维 `<= minStable`」的陈旧已交付元数据；对仍缓冲且 `msg.vc` 逐维 `<= minStable` 且本不应再被需要的消息可删——**测试只要求**：已交付消息的去重集合在 `gc` 后仍能阻止重复 receive；缓冲中因果上已被全体稳定覆盖的消息删除
- 简化实现要求：维护 `seenDelivered` 与 buffer；`gc` 删除 buffer 中 `vc <= minStable` 的条目，并修剪 `seen` 中 `seq <= minStable[from]` 的项

**与基础邮箱关系**
- 基础 `send`/`recv` 保持独立无序通道；因果 API 不使用该无序邮箱
- 测试不会混用两套通道做同一断言

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/vclock.ts` — 向量时钟工具
- `src/mailbox.ts` — 基础无序邮箱
- `src/buffer.ts` — 缺口缓冲与可交付
- `src/repair.ts` — 超时 repai
- `src/gc.ts` — 稳定点 GC
- `src/bus.ts` — `VecBuf` 门面
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
