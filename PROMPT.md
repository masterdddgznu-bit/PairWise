请在当前 TypeScript 仓库中补全 `src/db.ts`，使 `npm test` 与 `npm run build` 全部通过。

目标：实现进程内键值库 `Db`，事务隔离级别为可串行化快照隔离（SSI）。没有磁盘与线程，测试会交错调用 API。

必须满足：
1. 只允许修改 `src/`；禁止修改 `tests/`。
2. 全局提交时间戳从 1 递增。`begin()` 分配从 1 递增的事务号，记下 `startTs` = 当前已提交的最大时间戳（若尚无提交则为 0），状态为 active，读写集为空。
3. `read(tx, key)`：仅 active 事务可调用。先看本事务尚未提交的本地写；否则读「提交时间戳 ≤ startTs」的最新已提交版本。把该 key 记入读集（即使结果为 `undefined`，只要走过存储读路径；纯命中本地写不记读集）。返回 `string | undefined`。
4. `write(tx, key, value)`：仅 active 事务可调用。写入本地缓冲，并把 key 记入写集。允许覆盖本事务先前对同一 key 的本地写。`delete(tx, key)` 等价于写入墓碑：提交后该 key 对外不可见；读路径上墓碑与缺失一样返回 `undefined`，但若读的是已提交墓碑仍要记入读集。
5. 已提交历史按版本链保存。`get(key)` 不经过事务，返回最新已提交的可见值（跳过墓碑）。
6. `abort(tx)`：丢弃本地写，状态改为 aborted；对已结束事务再 abort 抛错。
7. `commit(tx)`：
   - 仅 active 可提交；空写集也允许提交（只结束事务，不推进全局时间戳）。
   - 与本事务并发的已提交事务 C，是指 `C.commitTs > startTs`。
   - 写写冲突：若写集与某个并发 C 的写集有交集，本次 commit 必须抛错并 abort 本事务，不留下已提交版本。
   - SSI：若存在并发 C1 使 `writeSet(C1) ∩ readSet(tx)` 非空（in-conflict），且存在并发 C2 使 `writeSet(tx) ∩ readSet(C2)` 非空（out-conflict），则抛错并 abort。C1 与 C2 可以是同一个事务。
   - 否则：若写集非空，分配新的 `commitTs`，把本地写（含墓碑）追加为该时间戳的已提交版本，并记录本事务的起止时间戳与读写集供后续冲突检查；写集为空则不分配 `commitTs`、不进入「已提交事务」集合。
8. `stats()` 返回 `{ active, committed, aborted, commitTs }`：当前 active 数、成功 commit 过的事务数（含空写集提交）、aborted 数、当前全局最大提交时间戳。
9. 不要引入外部依赖，不要改测试。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
