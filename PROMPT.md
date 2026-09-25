请在当前 TypeScript 仓库中补全 `src/` 下的多个模块，使 `npm test` 与 `npm run build` 全部通过。

目标：实现带访问控制的分片 KV。模块已经拆好，需要你把它们接成一个能跑的系统，并在「单分片快捷提交」与「跨分片 2PC」之间做出正确取舍。

模块职责（均可修改，且通常都需要改）：
- `src/acl.ts`：`Acl` 权限表。判断某用户能否对某个 key 做 `read` / `write`。
- `src/router.ts`：`Router` 根据固定分片表把 key 映射到 shardId；也能列出一次事务涉及的全部分片。
- `src/shard.ts`：`Shard` 本地存储与 2PC 参与者（prepare/commit/abort），以及单分片快捷 `apply`。
- `src/coord.ts`：`Coordinator` 编排跨分片 2PC；单分片事务不得走完整 2PC。
- `src/db.ts`：`Db` 门面，组合上述模块，对外提供 begin/get/put/commit/abort。

必须满足：
1. 只允许修改 `src/`；禁止修改 `tests/`。不要引入外部依赖。
2. 构造：`new Db({ shards, routing, acl })`
   - `shards`：`Record<shardId, Shard>`，测试会传入已构造的空 `Shard`。
   - `routing`：`Array<[prefix: string, shardId: string]>`。`Router` 用「最长前缀匹配」把 key 分到分片；若无前缀命中，抛错。
   - `acl`：`Array<{ user: string; perm: "read" | "write"; prefix: string }>`。某用户对 key 有权限，当且仅当存在一条规则：`user` 匹配、`perm` 精确匹配该操作，且 key 以 `prefix` 开头。`write` 不自动包含 `read`。
3. 事务：`begin(user)` 返回从 1 递增的 txId，绑定 user。`put(tx, key, value)` / `get(tx, key)` 先做 ACL：无权限抛错且不留下缓冲写。`get` 先看本事务缓冲，再读对应分片已提交数据。同一 tx 对同一 key 重复 `put` 覆盖缓冲。
4. 分片锁与 2PC（`Shard`）：
   - `prepare(tx, writes)`：`writes` 为该分片内 `Record<key, string>`。若任一 key 已被其他 tx 以 prepare 锁住，返回 `false` 且不改动本分片。成功则锁定这些 key，暂存 writes，返回 `true`。
   - `commit(tx)` / `abort(tx)`：提交则把暂存写入正式数据并解锁；中止则丢暂存并解锁。对未知 tx 幂等成功。
   - `apply(tx, writes)`：单分片快捷路径——原子写入并立即可见，不进入 prepared 状态；若 key 被其他 tx prepare 锁住则抛错。
   - `get(key)` 只读已提交数据。`stats()` 返回 `{ keys, prepared }`。
5. 协调器取舍（关键设计点）：
   - 计算事务写集涉及的分片集合。若 **恰好 1 个分片**：必须调用该分片 `apply`，不得调用 `prepare`/`commit` 两阶段；成功后事务结束。
   - 若 **2 个及以上分片**：必须 2PC——按 `shardId` 字典序依次 `prepare`；任一失败则对已 prepare 的分片 `abort`，本次 `Db.commit` 抛错且事务进入 aborted。全部成功再按字典序 `commit`。
   - 只读事务（无 put）：`commit` 直接成功，不访问分片写接口。
6. `Db.abort(tx)`：丢弃缓冲；若该 tx 已在某分片 prepare（测试主要覆盖显式 abort 在 commit 前），需确保无锁残留。对已结束事务再 commit/abort/get/put 抛错。
7. `Db.stats()` 返回 `{ active, committed, aborted, shardPrepared }`：活跃事务数、成功 commit 数、abort 数（含 2PC 失败导致的 abort）、所有分片 `prepared` 之和。
8. `Router.shardOf(key)` / `Router.shardsOf(keys)`、`Acl.check(user, perm, key)` 要单独正确，因为测试会直接引用这些模块。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
