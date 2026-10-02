请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的进程内严格两阶段锁（Strict 2PL）KV 半成品。单事务顺序读写通常正常；当你把「S/X 兼容、FIFO 等待队列、等待图死锁、VirtualClock 超时、S→X 升级、commit/abort 释放全部锁并唤醒、已提交可见性」组合在一起时，会出现不一致。请从锁表与等待队列出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止真实网络、定时器或加密；逻辑时间用 `VirtualClock`。Strict 2PL：无显式 unlock API，锁仅在 `commit` / `abort` 时全部释放。

对外入口是 `TwoPl`（见 `src/engine.ts` / `src/index.ts`）。

核心 API：

- `new TwoPl(clock?, opts?: { deadlock?: boolean; lockTimeoutMs?: number })` — `deadlock` 默认 true；`lockTimeoutMs` 默认 0（冲突时 expireAt=now，立即超时）
- `begin(): txId` — 返回 `t1`,`t2`,...
- `read(txId, key): string | undefined` — 获取 S 锁；优先读本事务写缓冲；否则读已提交存储；记录读集
- `write(txId, key, value)` / `delete(txId, key)` — 获取 X 锁（持有 S 时尝试升级）；写入本地缓冲（delete 记为 tombstone）
- `commit(txId)` — 将缓冲应用到已提交存储，释放该事务全部锁并按 FIFO 唤醒
- `abort(txId)` — 丢弃缓冲，释放全部锁并唤醒
- `get(key)` — 仅已提交可见值（忽略未提交写）
- `status(txId)` — `active` | `waiting` | `committed` | `aborted`
- `tick()` — `clock` 前进 1，并处理到期等待者（中止对应事务、释放其锁、丢弃缓冲）

锁冲突：
1. 无法立即授予时加入该 key 的 FIFO 等待队列，`expireAt = clock.now() + lockTimeoutMs`
2. 若开启死锁检测且等待图成环 → 移出队列并抛 `DeadlockError`（`name === "DeadlockError"`）
3. 若 `expireAt <= clock.now()` → 移出队列并抛 `LockTimeoutError`
4. 若仍在超时窗口内 → 事务标为 `waiting`，本次读写抛 `LockTimeoutError`（等待项保留；持有者释放后按 FIFO 授予，重试即可）
5. FIFO：有更早等待者时不得插队；释放后仅从队首起连续授予当前兼容的等待者

错误类（稳定 `name`）：`TxError`、`DeadlockError`、`LockTimeoutError`。

模块划分：
- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/compat.ts` — S/X 兼容
- `src/locktable.ts` — 持有关系
- `src/waiters.ts` — FIFO 等待队列
- `src/waitfor.ts` / `deadlock.ts` — 等待图与环检测
- `src/upgrade.ts` — S→X 升级
- `src/timeout.ts` — 到期处理
- `src/store.ts` — 已提交 KV
- `src/txn.ts` — 事务表与写缓冲
- `src/engine.ts` / `index.ts`

具体行为以 tests 为准。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
