请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的多副本 quorum KV 半成品。单副本 put/get 通常正常；当你把「R/W 仲裁、读前取 max 版本再写 W 副本、get 取最高版本、fail/heal 与健康副本集合、读修复、export/import 保留 down 集合、陈旧写拒绝」组合在一起时，会出现不一致。请从 quorum 选择与版本单调性出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止真实网络；副本均在进程内同步调用。

对外入口是 `QuorumKV`（见 `src/client.ts` / `src/index.ts`）。核心 API：

- `new QuorumKV({ n, r, w })` — 副本数与读写 quorum；须满足 r+w>n，否则 `QuorumError`
- `put(key, value, expectedVersion?)` — 先从 R 个健康副本读该 key 的 max 版本，再向 W 个健康副本写入 value 与 max+1；健康副本不足 W 则失败；若提供 expectedVersion 且已见更高版本则拒绝
- `get(key)` — 从 R 个健康副本读取，返回最高版本 `{ value, version }`；全部缺失则 undefined；读后对参与副本做读修复
- `failReplica(id)` / `healReplica(id)` — 标记副本下线/上线；下线副本不计入 quorum，heal 后重新计入
- `replicaGet(id, key)` — 测试 helper，直读某副本本地条目
- `exportState()` / `importState(state)` — 全集群快照（含各副本数据与 down 集合）

模块划分：
- `src/types.ts` / `src/errors.ts` — 选项、条目、快照类型
- `src/version.ts` — 版本合并与 max 选择
- `src/replica.ts` / `src/store.ts` — 单副本存储
- `src/quorum.ts` — r+w>n 校验与健康副本选择
- `src/heal.ts` — fail/heal 与 stale 标记
- `src/router.ts` — 读写路由到副本集合
- `src/client.ts` — `QuorumKV` 门面
- `src/recover.ts` — export/import
- `src/index.ts` — 统一导出

测试中可直接调用 `getReplicas()` 做副本状态注入；生产路径仍经 `put`/`get`/`replicaGet` 验证。

具体行为以 tests 为准。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
