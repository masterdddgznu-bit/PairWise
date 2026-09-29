请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Hirschberg–Sinclair 双向环选举** 任务：n 个进程组成双向环；每进程唯一 `uid`。`start(i)` 从相位 0 向左右各发 PROBE(uid, phase=0, hop=1)；收到更大 uid 的 PROBE 则按方向转发（hop-1）或 hop 耗尽后反向 REPLY；更小则吞掉；相等则当选并双向发 LEADER。一相位收齐左右两个 REPLY 后进入下一相位（hop=2^phase）。`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以消息队列为准）。

语义约束（测试会覆盖）：
- 构造：`new Hirsch({ clock, processCount=5, uids? })`。未给 `uids` 时为 `0..n-1`。`uids` 须长度 n、互异非负整数，否则 `InvalidConfigError`。`processCount<3` → `InvalidConfigError`（双向环至少 3）。下标 `0..n-1`；`left(i)=(i-1+n)%n`，`right(i)=(i+1)%n`。初始全部 online；`phase=0`；`replies=0`；`participant=false`；`leader=null`；inbox 空。
- 导出 `leftIndex(i,n)` / `rightIndex(i,n)` / `defaultUids(n)` / `hopForPhase(phase)`（返回 `2**phase`）。
- 方向：`"L" | "R"`。消息：
  - `{ kind:"PROBE", uid, phase, hop, dir, from, msgId }` — `dir` 为探测前进方向
  - `{ kind:"REPLY", uid, phase, dir, from, msgId }` — `dir` 为**原探测前进方向**（回复沿反方向传回）
  - `{ kind:"LEADER", uid, dir, from, msgId }`
- `start(id)`：非法 → `InvalidProcessError`；offline → `OfflineError`；已是 `participant` → `BusyError`。置 `participant=true`，`leader=null`，`phase=0`，`replies=0`；向 left 发 PROBE(uids[id],0,1,"L")，向 right 发 PROBE(...,"R")（两个 msgId）。返回较小的那个 msgId（先分配给 L 再 R，故返回 L 的 id）。不立即处理 inbox。
- `step(id)`：offline → `OfflineError`；inbox 空 → false。取队头：
  - PROBE：
    - `uid > mine`：若 `hop>1`，向同方向邻居发 PROBE(uid,phase,hop-1,dir)；若 `hop===1`，向**反方向**邻居发 REPLY(uid,phase,dir)（REPLY.dir 保持原探测 dir）。
    - `uid < mine`：吞掉；若当前不是 participant，则等同于对自己执行一次选举发起（`participant=true`，`leader=null`，`phase=0`，`replies=0`，向左右发 phase0/hop1 的 PROBE）——保证从低 uid 启动时最大 uid 仍会参选。
    - `uid === mine`：当选——`leader=uid`，`participant=false`；向 left 发 LEADER(uid,"L")，向 right 发 LEADER(uid,"R")。
  - REPLY：若 `uid !== mine`，沿**回程方向**（原探测 dir 的反方向）继续转发同内容 REPLY；若 `uid===mine` 且 `phase===消息.phase` 且仍为 participant：`replies += 1`；若 `replies===2`（本相位完成）：若 `hopForPhase(phase) >= floor(n/2)` 则当选（`leader=mine`，`participant=false`，双向发 LEADER）；否则 `phase += 1`，`replies=0`，向左右各发 PROBE(mine, phase, hopForPhase(phase), L/R)。其它（phase 不符或非 participant）忽略。
  - LEADER：`leader=uid`，`participant=false`；若 `uid !== mine`，沿消息 `dir` 继续转发 LEADER；若相等则吸收。
  返回 true。
- `pump(to?)`：指定 to 则反复 step；否则轮转 online 进程直到一轮无进展。
- `uidOf` / `leaderOf` / `leader()`（所有 online 的 leaderOf 相同且非 null 才返回，否则 null）/ `isParticipant` / `phaseOf` / `repliesOf` / `inboxSize` / `leftOf` / `rightOf` / `setOnline` / `isOnline`。
- 向下线邻居投递时**仍写入**其 inbox；`pump` 跳过 offline；对其 `start`/`step` 抛 `OfflineError`。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息与方向类型
- `src/errors.ts` — 错误类型
- `src/ring.ts` — left/right/defaultUids/hopForPhase
- `src/process.ts` — 单进程状态
- `src/hirsch.ts` — `Hirsch` 门面
- `src/index.ts` — 统一导出

对外 API 以 `Hirsch` / `VirtualClock` / ring 工具 / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
