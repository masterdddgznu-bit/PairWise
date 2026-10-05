## 简述
实现一个确定性的多租户用量计量、费率计价、修正与账期关闭协调器。系统仅模拟内存中的元数据与整数金额，并且必须在租约交织、跨账期修正、争议和日志恢复后维持可审计血缘。

## 需求
- 从 `src/index.ts` 导出 `MeterClose`、`MeterCloseError` 及公开类型。构造参数为 `{ leaseTtl, maxEvents, maxRatings }`，均为正安全整数。
- `registerShard` 为租户登记具名分片；`ingest` 接收不可变用量事件，包含 eventId、account、metric、quantity、occurredAt 与严格递增的分片 offset。相同事件重试幂等，冲突事件、offset 回退或缺口确定性拒绝。容量失败不得推进 offset 或日志。
- `publishTariff` 发布指标的不可变版本费率与不重叠生效区间。计价任务通过 `claimRating` 取得带单调 fence 的租约，并由 `completeRating` 将事件恰好一次绑定到其发生时间适用的费率，记录安全整数 minor-unit 金额及来源血缘。费率发布不得改变已计价历史；过期或陈旧 claim 不得改变计价或日志，只有 `drive` 会重排过期任务。
- `correct` 创建不可变 reversal/replacement 修正并拒绝重复冲突、修正链和环。关闭前，修正以平衡借贷血缘更新开放账期；关闭后，修正只形成后续开放账期的一次性 adjustment，绝不改写已终结发票。
- `openPeriod` 捕获租户当时的分片成员集合、各分片关闭水位及费率覆盖；后登记分片遵循下一成员版本。`finalize` 仅在捕获水位已到达、范围内事件与修正均已计价、金额与血缘对账且无活动计价租约时原子终结。终结水位以下的迟到事件拒绝，更高 offset 进入后续账期。
- `openDispute` 独立固定发票血缘；`resolveDispute` 支持 uphold 或 credit，credit 只向后续开放账期写入一次不可变 adjustment。存在开放争议或被修正引用时，`retireInvoice` 必须拒绝。
- `getEvent`、`getInvoice`、`listRatings`、`listAdjustments` 与 `journal` 返回防御性副本并确定排序。`MeterClose.fromJournal(config, records, now)` 精确恢复 offset、水位、血缘、费率版本、claim/fence、候选账期、发票、争议、adjustment、顺序和未来 ID，并拒绝序号缺口、未来时间、不可能 offset、金额不守恒、费率覆盖、血缘、关闭或争议迁移。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`。
- 禁止网络、数据库、文件持久化、`setTimeout` 与 `Math.random`；时间只来自显式 `now` 参数，且所有数量、offset、时间、fence 和金额必须是安全整数。
- 所有失败操作对分片、事件、费率、计价、修正、账期、争议、adjustment 和 WAL 保持原子性。
- 多租户数据隔离，但事件与计价容量为全局约束。实现必须拆分多个实质模块维护独立可变真相，禁止把全部状态机塞进单个门面文件。

## 验收
`npm test` 与 `npm run build` 全部通过。
