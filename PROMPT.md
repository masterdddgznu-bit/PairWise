## 简述
实现一个多租户不可变事件账本的段压缩协调器。它需要在段目录、消费进度与保留约束之间维持一致性，并允许可恢复的并发 worker 安全地产生与发布压缩结果。

## 需求
从 `src/index.ts` 导出 `LedgerCut`、`VirtualClock`、公开类型与错误类型。协调器管理按租户隔离、范围连续且不可变的 segment，记录 generation、checksum 与 lineage；支持命名 consumer checkpoint 以及 retention pin/hold。压缩计划必须确定性地产生和查询，worker 通过带单调 fence 的限时 lease 执行；只有输出范围、代际和 lineage 与仍然有效的源集合完全匹配时，才能原子发布替换。旧源只有在全部 checkpoint 与有效 pin 均越过其范围且没有相关活跃 job 后才能回收。所有成功状态变更写入按序追加的审计 journal，`fromJournal` 必须精确恢复目录、屏障、计划、fence、活跃 lease 及后续行为，并拒绝不可能的历史。查询结果不得暴露内部可变对象，租户之间不得互相影响。

## 约束
- 不要修改 `tests/`，不要增加外部运行时依赖。
- 时间只来自注入的 `VirtualClock`；仅 deadline 使用虚拟时间，时间经过本身不得偷偷执行清理。
- 失败操作必须原子回滚，不得留下部分目录、计划、lease、屏障或 journal 变化。
- segment 范围使用半开区间，空范围、空源集合、重叠或断裂范围均无效。
- stale worker、过期 lease 或旧 fence 不得改变目录及 journal；过期清理由显式 `drive()` 推进。
- journal 必须连续、按时间合法且语义可重放，恢复不得信任篡改后的派生状态。
- 宜拆分为多个真实协作模块，避免把所有真相集中在一个门面类中。

## 验收
`npm test` 与 `npm run build` 全部通过。
