请在当前 TypeScript 仓库中补全 `src/` 下的实现，使 `npm test` 与 `npm run build` 全部通过。

目标：实现一个进程内多 shard 的 MVCC KV，并由 Coordinator 跨 shard 做两阶段提交。

必须满足：
1. 只允许修改 `src/`；禁止修改 `tests/` 与测试断言；不要靠删测试蒙混过关。
2. 单 shard（`ShardStore`）提供 MVCC：
   - `begin` / `get` / `put` / `del` / `commit` / `abort`
   - 读隔离：事务只能读到自己 begin 时已提交的版本，以及本事务内写入
   - 写写冲突：若提交时目标 key 的最新提交版本晚于本事务 begin 快照，则 commit 失败并 abort
   - 删除以墓碑版本表示；快照读应正确跳过对当前快照不可见的墓碑/版本
3. Coordinator 跨多个 shard：
   - 事务可触及多个 shard 的 key（路由规则见 `src/routing.ts` 的既有约定）
   - 提交使用 2PC：所有参与者 prepare 成功才 commit；任一 prepare 失败则全体 abort
   - prepare 之后、全局 commit 之前允许模拟参与者崩溃；恢复后应根据 durable prepare 记录继续完成 commit 或 abort，且对客户端幂等
4. 不得引入网络/数据库等外部依赖；持久化可用内存结构模拟 “durable prepare log”，但崩溃恢复语义必须按测试约定实现。
5. 完成后确保 `npm test` 与 `npm run build` 通过；不要添加无关大文件。

验收：测试全绿，且 `tests/` 未被改动。
