## 简述
实现一个确定性的多租户不可变制品注册表与环境晋级协调器。制品依赖、环境锁快照、分群部署、回滚、回收和可恢复日志必须作为一个原子系统保持一致。

## 需求
从 `src/index.ts` 导出 `VirtualClock`、`PackagePromoter`、`PackagePromoter.fromJournal`、`PackagePromoteError` 及公开类型。构造配置包含 `{ clock, leaseMs, maxArtifacts?, maxEnvironments?, maxPromotions? }`，容量均为正整数。

制品以租户、包名和版本唯一标识，注册时记录不可变 digest 与依赖约束。重复身份仅允许完全相同的幂等注册；新增制品必须能通过确定性版本选择得到完整、无环的依赖闭包，选择先按版本数值段降序，再按版本文本和 digest 排序。全局制品容量失败不得留下部分依赖边或日志。

环境保存带递增 revision 的完整锁快照。`seedEnvironment` 建立初始快照，`updateEnvironment` 用于受控的直接 revision 更新；`beginPromotion` 从源环境冻结根需求与完整闭包，并以目标环境 revision 作为比较点。每个目标环境同时只能有一个活动晋级或回滚。发布前必须重新验证候选闭包未被 yank、目标未漂移且所有分群确认了完全相同的候选 revision。

分群成员资格按环境版本化。活动 rollout 使用开始时的成员快照；随后增加或移除分群只影响下一次 rollout。worker 通过带期限和单调 fence 的 lease 领取分群任务；过期但尚未 `drive()` 的任务仍占用，过期所有权不能确认或续租。`drive()` 只回收已到期 lease，并按租户、环境、分群的确定顺序返回结果。

`acknowledge` 只接受当前 owner、当前 fence 和精确候选 revision。所有快照分群确认后，`publish` 原子写入目标环境的新 lock revision 并结束 rollout。任何陈旧 fence、容量、冲突、依赖失效或部分确认都不得改变环境、制品引用或 WAL。

`beginRollback` 以目标环境历史 revision 创建后继 rollout，仍须经过依赖、yank、分群和 lease 安全检查，且不能绕过活动 rollout 冲突。yank 阻止新的解析及发布，但不破坏已固定环境。`collect` 只可删除已 yank 且未被任何环境 lock、活动候选、可回滚历史 pin 或 lease 工作的闭包引用所保护的制品；租户隔离不允许跨租户误删共享坐标。

每次成功状态变化追加 WAL；查询、失败、幂等调用和空 `drive` 不追加。`journal()` 返回防御副本。`fromJournal` 严格恢复制品图、环境 lineage、候选、成员快照、确认、owner/fence、历史 pin、回收状态以及后续 ID 和确定顺序；拒绝序号缺口、未来时间以及不可能的依赖、lineage、确认、阶段或引用转移。

## 约束
- 初始仓库没有 `src/`，请自行创建源码与合理模块划分；不要修改 `tests/`。
- 不得增加外部依赖，不得访问真实网络或数据库；禁止 `setTimeout`、`Date.now`、`Math.random`。
- 时间只来自注入的 `VirtualClock`；公开查询和日志必须提供防御副本。
- 所有跨域操作都必须先完整校验再提交，失败不得留下部分状态或 WAL。

## 验收
`npm test` 与 `npm run build` 全部通过。
