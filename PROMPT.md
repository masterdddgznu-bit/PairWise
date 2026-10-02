请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的进程内乐观并发控制（OCC）KV 半成品。单事务顺序读写通常正常；当你把「begin 冻结 startTs、读集记录、写集缓冲、提交时 WW 冲突、可选读集校验 RS、tombstone 删除、abort 丢弃缓冲、日志回放、export/import 恢复」组合在一起时，会出现不一致。请从校验顺序与可见性出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止真实网络、定时器或加密；逻辑时间用 `VirtualClock`。

对外入口是 `OccStore`（见 `src/engine.ts` / `src/index.ts`）。

核心 API：

- `new OccStore(clock?, opts?: { validateReads?: boolean })` — `validateReads` 默认 true
- `begin(): txId` — 返回 `t1`,`t2`,…；`startTs` / snap = 当前 `lastCommittedTs`
- `read(txId, key): string | undefined` — 优先本事务写集；否则读 startTs 可见的已提交值；记录读集
- `write(txId, key, value)` / `delete(txId, key)` — 写入本地写集（delete 记 tombstone `null`）
- `commit(txId): { ok: true, commitTs } | { ok: false, reason: "ww"|"rs" }` — `commitTs = clock.tick()`；检查 WW（写集与并发已提交写集相交）；若启用 `validateReads` 再检查 RS（读键在 startTs 之后被提交写过）；失败则中止事务
- `abort(txId)` — 丢弃缓冲
- `get(key)` — 仅已提交最新可见值
- `status(txId)` / `lastCommitTs()` / `exportState()` / `importState(state)`

错误类：`TxError`（稳定 `name === "TxError"`）。

模块划分：
- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/version.ts` / `store.ts` / `snapshot.ts` — 版本链与快照读
- `src/txn.ts` — 事务表、读写集
- `src/helpers.ts` / `validate.ts` — 集合相交与 WW/RS 校验
- `src/commit.ts` — 提交流水线
- `src/journal.ts` / `recover.ts` — 日志与恢复
- `src/engine.ts` / `index.ts`

具体行为以 tests 为准。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
