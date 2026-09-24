请在当前 TypeScript 仓库中补全 `src/lsm.ts`，使 `npm test` 与 `npm run build` 全部通过。

目标：实现进程内 LSM `Lsm`。没有真实磁盘，刷盘结果放在内存中的 SSTable 列表里，但语义要符合 WAL + memtable。

必须满足：
1. 只允许修改 `src/`；禁止修改 `tests/`。
2. `put` / `del` 先写 WAL 再改当前 memtable。`del` 写墓碑，即使 key 不存在也要记录。每次变更有严格递增的序号。
3. 读路径按新到旧：当前 memtable，然后已刷出的 SSTable（后刷的更新）。同 key 取序号最大的记录；墓碑使 `get` 返回 `undefined`。
4. `scan(start, end)` 返回 `[start, end)` 内、按 key 字典序排列的可见点。同一 key 只出现一次，墓碑不出现。
5. `flush()` 把当前 memtable 变成一张新的 SSTable 并清空 memtable。WAL 中序号小于等于这张表最大序号的记录要截掉，避免恢复时重复回放。空 memtable 调用 `flush()` 不得新增 SSTable。
6. `crash()` 丢掉 memtable，保留已刷盘的 SSTable 和尚未截断的 WAL。`recover()` 只重放剩余 WAL，重建 memtable，且不重复已存在于 SSTable 的旧序号。
7. 不要引入外部依赖，不要改测试。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
