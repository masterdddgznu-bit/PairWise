请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **三阶段提交（3PC）** 任务：1 个协调者 + n 个 cohort。`begin()` 开启事务并向所有 online cohort 发 CAN_COMMIT；cohort 按预设投票回复 YES/NO；全票 YES 则发 PRE_COMMIT，收齐 ACK 后发 DO_COMMIT；任一无票/超时/NO 则 ABORT。超时由 `VirtualClock` 驱动。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。必须使用注入的 `VirtualClock`。

语义约束（测试会覆盖）：
- 构造：`new ThreePc({ clock, cohortCount=3, voteTimeout=10, precommitTimeout=10 })`。`cohortCount<1` → `InvalidConfigError`。超时参数须为正整数否则 `InvalidConfigError`。cohort id 为 `0..n-1`；全部 online；预设投票默认 `true`；无进行中事务；协调者 phase=`idle`。
- `setVote(id, yes)`：设置该 cohort 收到 CAN_COMMIT 时的投票；非法 id → `InvalidProcessError`。可在 begin 前或后、但须在该 cohort **处理** CAN_COMMIT 之前生效。
- `begin()`：若已有未结束事务（phase 不是 `idle`/`committed`/`aborted`）→ `BusyError`。从 `committed`/`aborted`/`idle` 可再次 begin。分配 txId 全局递增字符串 `"1"`,`"2"`,…；phase=`voting`；记录 `voteDeadline = clock.now()+voteTimeout`；向每个 **当时 online** 的 cohort inbox 追加 `{ kind:"CAN_COMMIT", txId, msgId }`（msgId 另计全局递增）；**不**立即处理。返回 txId。若当时无任何 online cohort：立即 `aborted`（仍返回 txId）。
- `step(id)`：处理 cohort `id` 的 inbox 队头；offline → `OfflineError`；空 → false。
  - CAN_COMMIT：按 `setVote` 向协调者 inbox 追加 `{ kind:"VOTE", txId, from:id, yes, msgId }`；cohort 局部状态 `voted`；返回 true。
  - PRE_COMMIT：向协调者追加 `{ kind:"ACK", txId, from:id, msgId }`；局部 `precommitted`；返回 true。
  - DO_COMMIT：局部 `committed`；返回 true。
  - ABORT：局部 `aborted`；返回 true。
- `stepCoordinator()`：处理协调者 inbox 队头；空则先检查超时（见下）再返回 false（若因超时改变了状态仍返回 true）。
  - VOTE：记录该 from 的投票（同一 from 重复忽略）。若已收到**所有 begin 时 online 的 cohort** 的投票：若皆 yes → 进入 `precommitting`，设 `preDeadline=now+precommitTimeout`，向这些 cohort 发 PRE_COMMIT；若有 no → 向它们发 ABORT，phase=`aborted`。
  - ACK：记录 ack。若收齐全部应 ack 的 cohort → 发 DO_COMMIT，phase=`committed`。
  - 超时：在 `voting` 且 `now>=voteDeadline` 且尚未决出：向 begin 时 online 的 cohort 发 ABORT，phase=`aborted`。在 `precommitting` 且 `now>=preDeadline` 且未收齐 ack：同样 ABORT。
- `pump()`：反复轮转——对每个 online cohort `step(id)`，再 `stepCoordinator()`——直到一轮完全无进展（step 皆 false 且 coordinator 未因超时/消息改变）。
- `advance(ms)`：`clock.advance(ms)`，然后若处于 voting/precommitting 可立即用 `stepCoordinator()` 路径触发超时（`advance` 本身不自动 abort，须后续 `stepCoordinator` 或 `pump`）。
- `phase()`：`"idle" | "voting" | "precommitting" | "committed" | "aborted"`
- `outcome()`：`committed`→`"committed"`；`aborted`→`"aborted"`；否则 `"pending"`
- `cohortState(id)`：`"idle" | "voted" | "precommitted" | "committed" | "aborted"`
- `votes()`：已收到的 `{ id, yes }[]` 按 id 升序
- `acks()`：已收到 ack 的 cohort id 升序
- `inboxSize(id)` / `coordinatorInboxSize()` / `txId()`（无事务 null）
- `setOnline(id, online)` / `isOnline(id)`：offline 的 cohort 在**之后**的 begin 中不会被纳入；进行中事务仍只对 begin 时快照的集合负责。`step` 对 offline 抛错；`pump` 跳过。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息与状态类型
- `src/errors.ts` — 错误类型
- `src/cohort.ts` — 单 cohort 状态
- `src/coordinator.ts` — 协调者状态机（可与门面合并，但须有独立模块文件）
- `src/threepc.ts` — `ThreePc` 门面
- `src/index.ts` — 统一导出

对外 API 以 `ThreePc` / `VirtualClock` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
