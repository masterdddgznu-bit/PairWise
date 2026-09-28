请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Maekawa 投票互斥** 任务：n 个进程，每进程有投票集 Si（必须含自身，且任意 Si∩Sj 非空）。`request(i)` 递增 Lamport 并向 Si 各成员投入站 REQUEST；投票者同一时刻只把票锁给一个请求，其余按 (ts, pid) 升序排队；收齐 Si 的 REPLY 后进入临界区；`release(i)` 向 Si 发 RELEASE，投票者解锁并把票授予队头。`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以 Lamport 时间戳为准）。

语义约束（测试会覆盖）：
- 构造：`new Maekawa({ clock, processCount=3, votingSets? })`；进程 id `0 .. n-1`；全部 online；状态 idle；inbox/队列为空；未持票。`processCount===3` 且未给 `votingSets` 时默认 `S0=[0,1], S1=[1,2], S2=[0,2]`。若提供 `votingSets` 必须长度 n、每行含对应 id、任意两行相交，否则 `InvalidConfigError`。n≠3 且未给合法 `votingSets` 亦抛 `InvalidConfigError`。
- 导出 `intersect(a,b)`：两数组是否有公共元素；`defaultVotingSets(3)` 返回上述默认三集（拷贝）。
- `request(id)`：id 非法 `InvalidProcessError`；offline `OfflineError`；状态不是 idle 则 `BusyError`。该进程 `lamport += 1`，记 `requestTs=lamport`，状态 `waiting`，`granted` 清空；向 **Si 每个成员（含自己）** 的 inbox 追加 `{ kind:"REQUEST", from:id, ts:requestTs, msgId }`；`msgId` 全局递增字符串 `"1"`,`"2"`,…；**不立即处理 inbox**。返回 `msgId`。
- `release(id)`：非 `held` 抛 `NotHolderError`；offline `OfflineError`。状态回到 idle，清空 granted/requestTs；向 Si 每个成员 inbox 追加 `{ kind:"RELEASE", from:id, ts:其当时 lamport, msgId }`（同样全局递增）；不立即处理。
- `step(id)`：offline 抛 `OfflineError`。inbox 空则返回 false。否则取出队头：
  - REQUEST：若该投票者 `votingFor===null`，则 `votingFor=from`，向 `from` 的 inbox 追加 REPLY（`from` 为投票者 id，`ts` 为该 REQUEST 的 ts，新 msgId）；否则把 `{from, ts}` 插入等待队列（已有同一 from 则忽略）。返回 true。
  - REPLY：若接收方仍为 waiting，把 `msg.from` 加入 granted（集合）；当 granted 覆盖 Si 全部成员时状态变为 `held`。若已不是 waiting 则忽略。返回 true。
  - RELEASE：若 `votingFor===from`，则 `votingFor=null`，再按 (ts, from) 升序取队头（若有）立即授予（同 REQUEST 授予：设 votingFor、向其 inbox 追加 REPLY、从队列删除）。若当前锁的不是 from 则忽略。返回 true。
- `pump(to?)`：指定 to 则反复 `step(to)` 直到 false；否则轮转所有 **online** 进程直到一轮无人进展。
- `stateOf(id)`：`"idle" | "waiting" | "held"`
- `holder()`：处于 held 的进程 id，没有则 `null`（实现应保证同一时刻至多一个）
- `repliesOf(id)`：granted 中的投票者 id 升序
- `votingFor(id)`：该进程当前把票锁给谁，无则 `null`
- `queuedAt(id)`：等待队列中的 from，按 (ts, from) 排序后的 from 列表
- `inboxSize(id)` / `lamportOf(id)` / `votingSet(id)`（拷贝）
- `setOnline(id, online)`：下线后 `request`/`release`/`step` 均抛 `OfflineError`；`pump()` 跳过该进程；其上线后可继续 step。inbox/队列/锁状态保留。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息与状态类型
- `src/errors.ts` — 错误类型
- `src/quorums.ts` — `intersect` / `defaultVotingSets`
- `src/process.ts` — 单进程状态
- `src/maekawa.ts` — `Maekawa` 门面
- `src/index.ts` — 统一导出

对外 API 以 `Maekawa` / `VirtualClock` / `intersect` / `defaultVotingSets` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
