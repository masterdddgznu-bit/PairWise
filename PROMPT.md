请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **单决议 Paxos** 任务：多个 Acceptor；Proposer 用单调 ballot 走 Prepare→（多数）Promise→Accept→（多数）Accepted；某一 value 被多数 Accepted 后全局 **chosen**（至多一个）；Promise 若带回已接受值，Accept 阶段必须改推该值；阶段超时后提高 ballot 重试。驱动靠 `pump()`（不推进时钟）与 `tick()`（先 `advance(1)` 再处理超时并 `pump`）。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过注入的 `VirtualClock` 推进。

语义约束（测试会覆盖）：
- 构造：`new Paxos1({ clock, acceptorCount=3, phaseTimeout=5 })`；majority = `floor(n/2)+1`
- `propose(value)`：value 为空抛 `InvalidValueError`；分配 `proposalId`（`"1"`,`"2"`,…）；若已有 chosen：直接标记该提议 `chosen`（value 相同）或 `superseded`（不同），不发起新 ballot；否则创建 running 提议，分配新 ballot，进入 prepare 阶段并记录 `phaseStartedAt=now`，**不在 propose 内自动跑完**（需后续 `step`/`pump`/`tick`）
- `step()`：每个 running 提议至多执行一个阶段动作（prepare 或 accept 一次）；用于制造「已 Accept 但未达多数」等中间态
- `pump()`：反复 `step` 直到本轮无进展（可连续 prepare→accept→chosen）
- `setAcceptorOnline(id, online)`：离线 acceptor 对 prepare/accept 均不响应（视为失败）；用于模拟分区
- Acceptor：`prepare(b)` 仅当在线且 `b > promised` 成功并返回 `{ok:true,acceptedBallot,acceptedValue}`（无接受记录则 acceptedBallot=0, acceptedValue=null）；`accept(b,v)` 仅当在线且 `b >= promised` 成功并更新 accepted
- 多数 Promise 后：取 Promise 中 acceptedBallot 最大且 value 非 null 者作为要 accept 的 value，否则用自己的 originalValue
- 多数 Accepted → learner 记录 chosen；所有 running：若 `value===chosen` 或 `originalValue===chosen` 则为 `chosen`，否则 `superseded`
- `tick()`：`clock.advance(1)`；对 running 且 `now >= phaseStartedAt + phaseTimeout` 的提议：分配更大 ballot，清空阶段计数，回到 prepare；然后 `pump()`
- `status(id)`：`running|chosen|superseded|unknown`
- `chosenValue()` / `ballotCounter()`（已分配最大 ballot）

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 状态与回复类型
- `src/errors.ts` — 错误类型
- `src/quorum.ts` — majority / hasQuorum
- `src/ballot.ts` — 单调 ballot
- `src/acceptor.ts` — promised / accepted / online
- `src/proposer.ts` — 单提议状态
- `src/learner.ts` — chosen
- `src/paxos1.ts` — `Paxos1` 门面
- `src/index.ts` — 统一导出

对外 API 以 `Paxos1` / `VirtualClock` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
