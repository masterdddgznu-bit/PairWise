## 简述
实现一个确定性的多租户订单结算协调器，在纯内存元数据中协调库存批次、支付账本、履约、补偿与可重放日志。系统需要在并发式交织、过期、重试和恢复后仍保持资金与库存守恒。

## 需求
- 从 `src/index.ts` 导出 `BookSettle`、`BookSettleError` 以及公开类型。构造参数为 `{ reservationTtl, leaseTtl, maxOrders, maxWork }`，均为正安全整数。
- `addLot(tenant, sku, lot, quantity, now)` 添加有限库存；同一租户与 SKU 按 lot 字典序稳定分配。`createOrder(tenant, lines, total, currency, now)` 原子创建并预留库存，返回稳定订单 ID。订单行数量、金额均须为正安全整数，SKU 不得重复；容量、库存或参数错误不得留下库存、订单或日志的部分变化。
- `authorize(orderId, key, amount, now)` 使用全局幂等键授权。相同键只允许完全相同的订单与金额重试且不得重复写日志；不同载荷冲突。授权金额必须至少覆盖订单金额。`claim(kind, worker, now)`、`completeCapture`、`completeFulfillment`、`failFulfillment`、`completeCompensation` 协调 capture、fulfillment、compensation 工作。claim 返回含单调 fence 与 leaseUntil 的任务；过期或旧 fence 的完成不得改变任何状态或日志。
- `cancel(orderId, now)` 在未捕获时精确释放原批次预留；捕获后建立退款补偿义务，在补偿完成前不得恢复库存。`drive(now)` 是唯一处理预留期限和工作租约到期并重新排队的入口，返回其确定性处理顺序。
- `getOrder`、`getLots`、`getPayment`、`listWork` 与 `journal` 返回防御性副本，并按租户、订单、kind、稳定 ID 确定排序。租户库存与订单相互隔离，但订单和待办容量是全局约束。
- 日志是连续、只追加且包含逻辑时间的恢复来源。`BookSettle.fromJournal(config, records, now)` 必须精确恢复库存批次、原始分配、订单阶段、支付授权/捕获/退款、幂等键、补偿义务、活动租约、fence 与未来 ID。拒绝序号缺口、未来时间、不安全金额、库存不守恒、非法阶段、重复退款及错误血缘。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`。
- 禁止真实网络、支付、数据库、文件持久化、`setTimeout` 与 `Math.random`；所有时间只来自方法参数 `now`，且必须为非负安全整数。
- 所有公开输入都要校验；所有失败操作必须对库存、订单、支付、任务、补偿和日志保持原子性。
- 需要拆分为多个实质模块维护独立真相；禁止把状态机全部塞入单个门面文件。

## 验收
`npm test` 与 `npm run build` 全部通过。
