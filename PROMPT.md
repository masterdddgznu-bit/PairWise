## 简述
实现一个确定性的多租户纠删码条带修复与安全回收协调器。系统只管理元数据，不执行真实编码、网络或存储操作，并且必须能够由追加式日志完整恢复。

## 需求
从 `src/index.ts` 导出 `StripeHealCoordinator`、`ManualClock` 以及公开类型。协调器构造参数包含全局 fragment、plan、reader 容量和可用 failure domains；支持创建不可变的条带 manifest，报告 fragment 丢失或损坏，按租户检测并排队修复，领取带单调 fence 的租约，完成修复，开启/关闭 reader，推进过期与回收，以及导出日志并通过 `fromJournal` 恢复。

每个 manifest 将对象 generation 映射为 `k` 个数据片和 `m` 个校验片；活跃 fragment 的 failure domain 必须互异。修复计划必须捕获源 manifest generation 和足够的健康源片，目标域不得与活跃片冲突。完成操作只有在 lineage、源健康状态、租约和 fence 都仍有效时才可记录产物并发布 successor；失败操作不得遗留 fragment、目标预留、容量消耗或日志。发布后 predecessor 及被替换 fragment 进入 obsolete，但 reader pin 或 repair source reference 存在时不得回收。

reader 和 worker 的到期均以时钟判定，过期后 owner 操作立即无效，但资源只在显式 `drive()` 时释放或重排。所有 ID、计划顺序、目标域选择和 fence 必须确定；租户共享全局容量，任一容量失败都不得部分修改状态。`journal()` 返回防御副本；`fromJournal(entries, clock)` 必须精确恢复 lineage、inventory、容量、计划、预留、fence、reader pin 和未来确定性顺序，并拒绝日志序号缺口、未来时间及不可能的 quorum、placement、lineage 或守恒转换。

## 约束
- TypeScript strict；不得修改 `tests/`，不得增加外部依赖。
- 禁止真实网络、数据库、文件存储、计时器、`Date.now()`、`setTimeout` 与 `Math.random()`；时间只能来自 `ManualClock`。
- 所有公开返回值和日志必须防御复制；调用者修改输入或返回对象不得改变内部状态。
- 零损失检测是无副作用 no-op，不追加 WAL；任一被拒绝或 stale 的操作同样不得追加 WAL。
- 实现须拆分为多个真实协作模块，不能把全部状态与不变量塞入单个门面文件。

## 验收
`npm test` 与 `npm run build` 全部通过。
