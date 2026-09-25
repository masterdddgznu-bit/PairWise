请在当前 TypeScript 仓库中补全 `src/store.ts`，使 `npm test` 与 `npm run build` 全部通过。

目标：实现进程内的 Percolator 风格存储 `Store`。没有真实多机，所有 key 在同一地址空间，但要保留 data / lock / write 三列语义。`commit` 只持久化主键；从键依赖读路径前滚，模拟异步二次提交。

必须满足：
1. 只允许修改 `src/`；禁止修改 `tests/`。
2. `getTs()` 返回严格递增的正整数时间戳（1,2,3…）。
3. 每个 key 可有多版 `data(startTs -> value|null)`、至多一个 `lock(startTs, primary)`、多版 `write(commitTs -> startTs)`。`null` 为墓碑；对外读 API 对墓碑返回 `undefined`。
4. `prewrite(primary, mutations, startTs)`：
   - `mutations` 为 `{ key, value }[]`，`value` 为 `string` 或 `null`。必须包含主键 `primary`，且 key 不重复；否则抛错。
   - 对每个 key：若已存在任意 lock，或存在 `commitTs > startTs` 的 write，抛错；失败时本次调用不得留下任何新的 lock/data。
   - 成功则对每个 key 写入 `data(startTs)` 与 `lock(startTs, primary)`（从键的 primary 字段也指向主键）。
5. `commit(primary, startTs, commitTs)`：
   - 若 `commitTs <= startTs` 抛错。
   - 主键上必须存在 `lock(startTs)` 且其 primary 等于 `primary`，否则抛错。
   - 只提交主键：写入 `write(commitTs -> startTs)`，删除主键 lock。不要在 `commit` 里清理从键。
6. `get(key, startTs)`：
   - 若 key 上存在 lock 且 `lock.startTs < startTs`，先清理该锁：
     - 在主键上查找是否存在 `write.startTs == lock.startTs` 的记录。若有，取对应的 `commitTs`，对本 key **前滚**：写入同样的 `write(commitTs -> startTs)`，删除 lock，保留 data。
     - 若没有，则 **回滚** 整个该 `startTs` 事务：删除所有 `lock.primary == 该主键 && lock.startTs == 该 startTs` 的 lock（含主键），并删除这些 key 在该 startTs 的 data。
   - 若 lock 存在但 `lock.startTs >= startTs`，忽略该锁（未提交对当前快照不可见）。
   - 然后在 write 中选 `commitTs <= startTs` 的最大 commitTs，用其 startTs 取 data；墓碑或缺失则返回 `undefined`。
7. `rollback(primary, startTs)`：删除主键与所有从键上 `lock.primary == primary && lock.startTs == startTs` 的 lock，以及这些 key 在该 startTs 的 data。若本来就没有主键锁，视为幂等成功（仍要清掉残留从锁与 data）。
8. `stats()` 返回 `{ ts, locks, writes }`：已发放的最大时间戳、当前 lock 总数、全部 write 条数。
9. 不要引入外部依赖，不要改测试。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
