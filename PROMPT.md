请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的 MVCC 快照隔离 + SSI 写偏斜检测半成品。单事务顺序读写通常正常；当你把「快照冻结、多版本可见性、写-写冲突、SSI 反依赖、删除 tombstone、abort 缓冲、日志回放、export/import 恢复」组合在一起时，会出现不一致。请从版本可见性与提交顺序出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止真实网络、定时器或加密；逻辑时间用 `VirtualClock`。

对外入口是 `MvccSsi`（见 `src/engine.ts` / `src/index.ts`）。

核心 API：

- `new MvccSsi(clock, opts?: { ssi?: boolean })` — `ssi` 默认 true
- `begin(): txnId` — 快照时间 = 当前最后提交时间戳
- `read(txnId, key): string | undefined` — 可见版本：commitTs ≤ 快照 的最新值（已删除则 undefined）
- `write(txnId, key, value)` / `delete(txnId, key)` — 写入本地缓冲
- `commit(txnId): { ok, reason? }` — 分配 commitTs = clock.tick()；检查 WW；若启用 SSI 则检测写偏斜；失败返回 `{ ok: false, reason }`
- `abort(txnId)` — 丢弃缓冲
- `get(key): string | undefined` — 已提交最新可见值
- `exportState()` / `importState(state)` — 全状态快照（含版本、活跃/已结束事务、日志）

模块划分：
- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/version.ts` / `store.ts` / `snapshot.ts` — 多版本与快照读
- `src/txn.ts` — 事务状态、读写集
- `src/conflict.ts` / `ssi.ts` — WW 与 SSI 检测
- `src/commit.ts` — 提交流水线
- `src/journal.ts` / `recover.ts` — 日志与恢复
- `src/engine.ts` / `index.ts`

`committedRead(key)` 为测试 helper，返回已提交最新可见值（忽略未提交写）。

具体行为以 tests 为准。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
