请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内两阶段提交（2PC）任务：协调者管理事务生命周期，参与者持有键值资源并在 prepare 时加锁；协调者把决策写入 journal；准备阶段可用 VirtualClock 超时强制中止；`crashCoordinator` 丢失协调者内存态后须靠 journal + 参与者 in-doubt 状态 `recoverCoordinator` 收尾。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过注入的 `VirtualClock` 推进。

语义约束（测试会覆盖）：
- 构造：`new Twopc({ clock, participantCount=3, prepareTimeout=10 })`；参与者 id 为 `0 .. participantCount-1`
- `begin()`：分配递增字符串 txId（`"1"`,`"2"`,…），状态 `open`，journal 追加 `{type:"begin", txId}`
- `write(txId, participantId, key, value)`：仅 `open` 可写；同一 tx 对同一 `(participantId,key)` 后者覆盖前者；非法 participant / 未知 tx / 非 open 抛对应错误
- `prepare(txId)`：
  - 仅 `open` 可 prepare；无任何 write 则直接 `aborted`（journal `abort`）
  - 对涉及的每个参与者调用 prepare；任一 vote=`no`（键已被其他 tx 锁住）→ 全员 abort，状态 `aborted`，journal `abort`
  - 全员 `yes` → 状态 `prepared`，journal `prepared`，记录涉及的 participantIds
  - 进入 preparing 时设置 `deadline = now + prepareTimeout`；若此刻已到期（例如 `prepareTimeout=0`）或 `tick` 发现仍为 preparing 且到期，则 abort
- `commit(txId)`：仅 `prepared`；journal `commit`；通知参与者 commit；状态 `committed`
- `abort(txId)`：`open`/`preparing`/`prepared` 可 abort（已终态则抛错）；journal `abort`；通知已 prepare 的参与者 abort
- `tick()`：`clock.advance(1)`；对所有 `preparing` 且 `now >= deadline` 的 tx 执行超时 abort
- `status(txId)`：`open|preparing|prepared|committed|aborted`
- `read(participantId, key)`：读参与者已提交数据（未 commit 的 prepare 不可见）
- `crashCoordinator()`：清空协调者内存中的 tx 表与写缓冲，**保留 journal 与参与者状态**
- `recoverCoordinator()`：
  - 扫描 journal：对有 `prepared` 且其后无 `commit`/`abort` 的 tx → **commit**（已达 prepare 点必须结束）
  - 对有 `begin` 但无终态且无 `prepared` 的 tx → **abort**，并 `forceAbort` 各参与者上该 tx 的 in-doubt
  - 重建 status 查询所需终态
- 参与者锁：prepare 成功则锁住 key 直到 commit/abort；他 tx prepare 同 key 返回 no
- `journal.entries()` 测试会读到追加顺序

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 状态 / journal 记录 / vote
- `src/errors.ts` — 错误类型
- `src/journal.ts` — 追加型日志
- `src/participant.ts` — 资源 + 锁 + prepare/commit/abort
- `src/timeouts.ts` — preparing 截止
- `src/coordinator.ts` — 事务状态机
- `src/recover.ts` — crash 恢复
- `src/twopc.ts` — `Twopc` 门面
- `src/index.ts` — 统一导出

对外 API 以 `Twopc` / `VirtualClock` / 错误类型为准（见各模块导出）。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
