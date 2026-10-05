## 简述
实现一个确定性的多租户、多区域配额托管协调器。系统需要在区域权利转移、带 fence 的操作预留和可审计恢复同时发生时，始终守住全局容量与租户配额守恒。

## 需求
从 `src/index.ts` 导出 `EscrowMesh`、`EscrowError` 及公开类型。`EscrowMesh` 接受全局容量，提供 `addTenant`、`prepareTransfer`、`acceptTransfer`、`cancelTransfer`、`reserve`、`commitReservation`、`releaseReservation`、`drive`、`tenantView`、`transferView`、`reservationView`、`journal`，以及静态 `fromJournal`。租户初始配额须拆分到不同区域，所有租户配置配额之和不得超过全局容量。

区域间转移采用 prepare 后 accept 或 cancel 的两阶段语义，并由 epoch 与 nonce 唯一标识；prepare 锁定发送方权利，accept 才令接收方取得权利，cancel 只恢复一次。重复消息、冲突阶段、陈旧 epoch 和非法重放必须具有确定结果。操作预留只能使用区域本地可用权利，绑定 owner、worker、递增 fence 和到期时间；commit 永久消耗对应租户配额，release 恢复本地权利，显式 `drive(now)` 按确定顺序回收已到期预留。失效身份、错误 fence 或不允许的阶段不能改变任何真相。

每次真实变更追加一条连续序号的审计 WAL；幂等重试不得制造重复变更。`fromJournal(entries, recoveryNow)` 必须精确恢复区域余额、锁定权利、已消耗配额、转移阶段、活动预留、后续 ID 与 fence，并拒绝序号缺口、未来时间、重复变更、非法阶段和不可能的守恒状态。所有查询和 WAL 返回防御性副本，租户及区域必须隔离。

## 约束
- 使用 TypeScript，公开方法同步且确定；时间仅来自方法参数，禁止真实时钟、网络、数据库、`setTimeout` 与 `Math.random`。
- 不得修改 `tests/`，不得新增外部运行时依赖。
- 数量、时间、epoch 和 fence 使用安全整数；拒绝零额、负数、自转移、未知租户或区域以及容量超配。
- 任一失败操作必须原子回滚，且不得追加 WAL；守恒关系在预留、转移和恢复的任意交织后成立。
- 实现应拆分多个真实协作模块，但内部文件布局与算法由你决定。

## 验收
`npm test` 与 `npm run build` 全部通过。
