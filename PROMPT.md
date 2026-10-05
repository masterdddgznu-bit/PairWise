## 简述
实现一个确定性的多租户机器学习制品治理协调器，在纯内存元数据上同时维护不可变血缘、评估证据、端点流量、分阶段发布、会话固定、回滚与安全退役。

## 需求
从 `src/index.ts` 导出 `VirtualClock`、`ModelGateError` 与 `ModelGate`。`ModelGate` 需支持注册租户隔离的数据集、特征契约和模型版本；模型必须绑定精确父数据集、可选父模型、特征契约修订及摘要，并原子校验血缘无环、兼容性和全局容量。支持注册不可变评估套件、创建候选评估、带租约和单调 fence 的领取、提交签名元数据证据及模型 supersede；只有针对精确血缘且覆盖全部必需套件的未过期证据才能开始发布。

端点由递增 route revision 和总和严格为 10000 的整数基点分配构成。发布捕获目标 route revision、证据 frontier、契约修订、cohort membership revision 和分阶段分配计划；cohort 确认和健康观测共同门控阶段应用，且应用必须原子拒绝路由、证据或契约漂移。发布期间新增 cohort 的归属由捕获的 membership revision 决定。健康失败必须形成唯一且确定的回滚义务；回滚创建后继 route revision，同时保留旧会话固定。

会话独立固定端点 route revision 与模型版本。评估者和会话租约到期后，owner 操作立即无效，但只有显式 `drive()` 才能按确定顺序释放或重排。数据集、契约和模型只有在没有路由、活动发布或评估、回滚历史 pin、活会话及其依赖闭包引用时才能退役。所有成功变更写入 append-only journal；`ModelGate.fromJournal` 必须精确恢复血缘、证据 frontier、claim/fence、路由、发布/cohort、会话、回滚、退役以及未来 ID 和顺序，并拒绝序号缺口、未来时间及不可能的血缘、兼容、证据、流量、pin、健康或阶段转换。所有输入、查询结果和 journal 都不得泄露可变内部引用。

公开方法至少覆盖 `registerDataset`、`registerContract`、`registerModel`、`registerSuite`、`createEvaluation`、`claimEvaluation`、`completeEvaluation`、`supersedeModel`、`seedEndpoint`、`addCohort`、`beginRollout`、`acknowledgeCohort`、`observeHealth`、`applyStage`、`fulfillRollback`、`openSession`、`touchSession`、`closeSession`、`drive`、`retire`、`journal`、`snapshot` 和静态 `fromJournal`。公开视图应提供完成任务所需的确定性 ID、revision、fence、deadline、phase、分配与 pin 信息。

## 约束
- 不要修改 `tests/`，不要添加外部依赖。
- 禁止真实网络、数据库、文件存储、定时器、`Date.now`、`setTimeout`、`Math.random`；时间只能来自注入的 `VirtualClock`。
- 所有 ID、排序、过期释放、重放结果必须确定；租户之间不得形成引用。
- 任一失败操作不得留下索引、容量、路由、证据、fence 或 WAL 的部分变更；流量分配始终为非负整数且总和恰为 10000。
- journal 为只追加事件流；重放不得偷偷补写事件，也不得接受篡改后的嵌套对象。

## 验收
`npm test` 与 `npm run build` 全部通过。
