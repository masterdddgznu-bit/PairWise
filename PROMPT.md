请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的内存 KV（put / get / delete / has / keys / size）。请在此基础上迭代实现 WAL 先写日志、checkpoint、崩溃恢复，以及 value 二级索引，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；可用 `VirtualClock` 记录 checkpoint 时间（测试主要断言逻辑时钟字段存在即可）。

对外入口是 `WalKV`（见 `src/kv.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `put(key, value)` / `get(key)` / `delete(key) -> boolean` / `has(key)` / `keys()`（字典序）/ `size()`
- 基础阶段无 WAL、无索引、无恢复

## 待迭代功能

**WAL（先写日志）**
- 每条成功变更在应用到 memtable **之前**追加一条日志：
  - `{ lsn: number; op: "put"|"delete"; key: string; value?: string; at: number }`
  - `lsn` 从 1 严格递增；`at = clock.now()`
- `put` 覆盖写也要追加新 put 记录
- `delete` 仅当键当时存在时追加 delete 并返回 true；不存在则 false 且**不**写 WAL、不递增 lsn
- `walRecords() ->` 当前耐久日志的拷贝（按 lsn 升序）
- `nextLsn() -> number`：下一条将使用的 lsn（即 `lastLsn + 1`，空日志为 1）

**Checkpoint**
- `checkpoint() -> { lsn: number; at: number; keys: number }`
  - 将当前 memtable 的存活快照固化为 checkpoint（含全部 key/value）
  - checkpoint 的 `lsn` = 当时已应用的最大 WAL lsn（空库为 0）
  - 截断 WAL：删除 `lsn <= checkpoint.lsn` 的记录，仅保留之后的
  - 返回值中 `keys` 为快照键数；`at = clock.now()`
- `latestCheckpoint() ->` 上述结构 | `null`（尚未做过 checkpoint）

**崩溃恢复 `crashAndRecover()`**
- 模拟进程崩溃：丢弃易失 memtable 与易失二级索引
- 然后从 `latestCheckpoint`（若有）加载快照，再按 lsn 升序重放剩余 WAL，重建 memtable 与二级索引
- 恢复后数据与索引须与崩溃前一致；`nextLsn()` 继续单调（不得复用已用过的 lsn）
- 无 checkpoint 且 WAL 非空：仅重放 WAL
- 无 checkpoint 且 WAL 空：空库

**二级索引（按 value）**
- `findByValue(value) -> string[]`：当前所有 value 等于该值的 key，字典序
- 随 put/delete/recover/checkpoint 重放保持最新
- 覆盖写：旧 value 的索引移除，新 value 加入
- delete：从索引移除

**只读辅助**
- `durability() -> { walLen: number; checkpointLsn: number | null }`

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/wal.ts` — 日志追加与截断
- `src/memtable.ts` — 易失表
- `src/checkpoint.ts` — 快照
- `src/index.ts` 二级索引实现放在 `src/secindex.ts`（避免与包入口重名）
- `src/recover.ts` — 恢复
- `src/kv.ts` — `WalKV` 门面
- `src/index.ts` — 包导出

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
