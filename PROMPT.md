请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **向量钟因果广播（Causal Broadcast）** 任务：n 个进程各持向量钟；`broadcast` 先递增本地分量再向其他在线进程投递带戳消息；接收方若因果未就绪则入缓冲，就绪则投递并合并向量钟，再尽量释放缓冲；`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以向量钟为准）。

语义约束（测试会覆盖）：
- 构造：`new VectorCb({ clock, processCount=3 })`；进程 id `0 .. n-1`；每进程向量钟长度为 n，初值全 0；全部 online；已投递日志为空；缓冲为空
- 向量比较辅助须导出：`le(a,b)`（逐分量 ≤）、`ready(vt, local, sender)`：消息戳 `vt`、发送者 `sender`、接收方本地钟 `local` 满足因果投递条件当且仅当：
  - `vt[sender] === local[sender] + 1`
  - 对所有 `k !== sender`：`vt[k] <= local[k]`
- `merge(local, vt)`：逐分量取 max，返回新数组（不修改入参）
- `broadcast(from, payload)`：`payload` 为空抛 `InvalidPayloadError`；from 须 online 否则 `OfflineError`；`local[from] += 1`；令 `vt = local` 的拷贝；向**除自己外所有当时 online** 的进程投入站队列（不立即投递）；发送方**本地立即写入 delivered**（不经 inbox，钟已在递增后就绪，勿再 merge）；返回该消息的 `msgId`（全局递增字符串 `"1"`,`"2"`,…）
- `step(to)`：对进程 `to` 的入站队列取队头一条（若有）：若 `ready(vt, local, sender)` 则投递（写入 delivered 日志、`local = merge(local, vt)`），返回 true；否则移入该进程缓冲并返回 true（仍算消费了队头）；队列空则尝试从缓冲中找任意一条已 ready 的投递（确定性：选 `msgId` 最小者），成功返回 true；否则 false
- `pump(to?)`：若指定 to 则反复 `step(to)` 直到 false；否则轮转所有进程直到一轮无人进展
- `delivered(id)`：按投递顺序列出 `{ msgId, from, payload }`
- `clockOf(id)`：向量钟拷贝
- `buffered(id)`：缓冲中 msgId 列表（升序）
- `inboxSize(id)`：入站队列长度
- `setOnline(id, online)`：下线后不再向其投递新 broadcast；其 inbox/buffer 保留但 `step` 在 offline 时抛 `OfflineError`；上线后可继续 `step`

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/vector.ts` — le / ready / merge
- `src/process.ts` — 单进程状态
- `src/vectorcb.ts` — `VectorCb` 门面
- `src/index.ts` — 统一导出

对外 API 以 `VectorCb` / `VirtualClock` / 向量工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
