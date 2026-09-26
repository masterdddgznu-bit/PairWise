请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个多副本 Causal KV 任务：N 个副本（默认 3）各自维护本地 store 与 op-log；并发无因果序的 put 产生 siblings；带 context 的因果 put 可覆盖/收敛；`syncAll` 做反熵拉取缺失更新；`Session` 在客户端维护 context，提供跨副本的 read-your-writes 与 monotonic-reads。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；若需要调度语义，时间一律通过 `VirtualClock` 推进（因果序本身是逻辑的，不依赖墙钟）。

推荐设计：
- 每个副本维护事件日志 `{ key, value, vv, replicaId, counter }`
- 本地 put 推进本副本在向量时钟上的分量（结合可选 client `context`）
- `get` 返回所有未被支配的并发值（siblings）；若已收敛则只有一个值；`context` 为返回版本时钟的 merge
- `sync` / `syncAll`：按对端 `storeVV` 找出尚未覆盖的 op 并应用（已被支配的版本可剪枝）
- `Session` 在 get/put 后更新本地 context，避免读到已被自己读过历史支配的旧值

模块划分：
- `src/clock.ts` — `VirtualClock`（API 一致性 / 可选同步调度）
- `src/vector_clock.ts` — compare / merge / increment / dominates / concurrent
- `src/types.ts` — Value、SiblingSet、Op 等
- `src/replica.ts` — 本地 store + op-log
- `src/anti_entropy.ts` — 同步协议
- `src/session.ts` — 客户端会话保证
- `src/cluster.ts` — 门面：创建集群、`replica`、`syncAll`
- `src/errors.ts` — 可选错误类型
- `src/index.ts` — 统一导出

对外 API 以 `Cluster` / `Replica` / `Session` / `VectorClock` 为准（见各模块导出）。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
