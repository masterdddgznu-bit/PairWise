请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Chang–Roberts 环选举** 任务：n 个进程组成单向环（i → (i+1)%n）；每进程有唯一 `uid`。`start(i)` 置 participant 并向后继发 ELECTION(uid_i)；收到 ELECTION(u) 时：若 u>自己则转发，若 u<自己且尚未参与则发起自己的选举，若 u==自己则当选并发送 LEADER(u)；收到 LEADER 则记录领袖、清除 participant，非起源者继续转发。`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以消息队列为准）。

语义约束（测试会覆盖）：
- 构造：`new ChangRob({ clock, processCount=5, uids? })`。未给 `uids` 时默认为 `0..n-1`。若给 `uids`：长度须为 n、元素两两不同的非负整数，否则 `InvalidConfigError`。`processCount<2` → `InvalidConfigError`。进程下标 `0..n-1`；后继 `next(i)=(i+1)%n`。初始全部 online；`participant=false`；`leader=null`；inbox 空。
- 导出 `nextIndex(i, n)`、`defaultUids(n)`（返回 `[0,1,…,n-1]`）。
- `start(id)`：非法 id → `InvalidProcessError`；offline → `OfflineError`；若已是 `participant` → `BusyError`。置 `participant=true`，清空本进程已知 `leader`（置 null）；向后继 inbox 追加 `{ kind:"ELECTION", uid:uids[id], from:id, msgId }`。`msgId` 全局递增 `"1"`,`"2"`,…。**不立即处理 inbox**。返回 `msgId`。
- `step(id)`：offline → `OfflineError`。inbox 空 → false。否则取队头：
  - ELECTION(u)：
    - 若 `u > uids[id]`：向后继转发同 uid 的 ELECTION（新 msgId，`from` 仍为消息原 `from` 或当前 id 均可，测试只关心 uid 传递；实现用 `from:id`）；本进程不必因此变 participant。
    - 若 `u < uids[id]`：若当前不是 participant，则 `participant=true`、`leader=null`，向后继发 ELECTION(uids[id])；若已是 participant 则吞掉（不转发）。
    - 若 `u === uids[id]`：当选——`leader=u`，`participant=false`，向后继发 `{ kind:"LEADER", uid:u, from:id, msgId }`。
  - LEADER(u)：`leader=u`，`participant=false`；若 `u !== uids[id]` 则向后继转发 LEADER(u)；若 `u === uids[id]` 则吸收（环一圈结束，不转发）。
  返回 true。
- `pump(to?)`：指定 to 则反复 `step(to)` 直到 false；否则轮转所有 **online** 进程直到一轮无人进展。
- `uidOf(id)` / `leaderOf(id)`（该进程已知领袖 uid，未知则 `null`）/ `leader()`：若所有 online 进程的 `leaderOf` 相同且非 null 则返回该值，否则 `null`（允许选举进行中不一致）
- `isParticipant(id)` / `inboxSize(id)` / `nextOf(id)`（后继下标）
- `setOnline(id, online)` / `isOnline(id)`：下线后 `start`/`step` 抛 `OfflineError`；`pump()` 跳过；向后继投递时**仍写入**其 inbox（即使对方 offline）。inbox/participant/leader 状态保留。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息类型
- `src/errors.ts` — 错误类型
- `src/ring.ts` — `nextIndex` / `defaultUids`
- `src/process.ts` — 单进程状态
- `src/changrob.ts` — `ChangRob` 门面
- `src/index.ts` — 统一导出

对外 API 以 `ChangRob` / `VirtualClock` / `nextIndex` / `defaultUids` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
