请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的多副本复制日志半成品。单副本或 w=1 的 append/read 通常正常；当你把「写 quorum、连续 committed 索引、fail/heal 与健康副本集合、truncate 与 committed 回退、heal 后追平日志、export/import 保留 down 集合」组合在一起时，会出现不一致。请从 quorum 计数与 committed 单调连续性出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止真实网络、定时器或加密；副本均在进程内同步调用。

对外入口是 `ReplicLog`（见 `src/log.ts` / `src/index.ts`）。Leader 固定为 replica 0。索引从 1 开始。

核心 API：

- `new ReplicLog({ n, w })` — n 副本、写 quorum w（1<=w<=n）；否则 `ReplicError`
- `append(payload: string): { index }` — leader 追加并复制；≥w 个健康副本（含 leader）持有该条目时提交；返回已提交 index
- `committed(): number` — 最高连续已提交 index（无空洞）；无条目时为 0
- `read(index): string | undefined` — 仅当 1<=index<=committed() 时返回 payload
- `failReplica(id)` / `healReplica(id)` — 下线/上线；下线不计入 quorum；heal 后须从 leader 追平缺失条目
- `replicaLastIndex(id)` — 测试 helper，该副本当前最高 index（无条目为 0）
- `truncateAfter(index)` — 所有健康副本丢弃 index 之后条目；必要时下调 committed
- `exportState()` / `importState(state)` — 全集群快照（含各副本日志、committed、down 集合）

模块划分：
- `src/types.ts` / `src/errors.ts` — 选项、条目、快照类型
- `src/entry.ts` — 条目与 index 辅助
- `src/replica.ts` — 单副本 append-only 日志
- `src/quorum.ts` — w 校验与健康副本选择
- `src/leader.ts` — leader append 与复制路由
- `src/truncate.ts` — 截断与 committed 调整
- `src/heal.ts` — fail/heal 与 down 集合
- `src/recover.ts` — export/import
- `src/log.ts` — `ReplicLog` 门面
- `src/index.ts` — 统一导出

具体行为以 tests 为准。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
