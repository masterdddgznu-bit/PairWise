## 简述
实现一个多租户 envelope-key 轮换协调器。系统以实时状态协调对象重加密、带 fencing 的 worker 租约和旧 key epoch 退役，并用只追加审计日志完整恢复状态。

## 需求
- 从 `src/index.ts` 导出 `KeyRoll`、`VirtualClock`、相关错误类与公开类型。构造方式为 `new KeyRoll({ clock, leaseMs, maxTenants?, maxObjects?, maxTasks? })`。
- `registerTenant(tenant, initialEpoch)` 注册租户；`registerObject(tenant, objectId)` 将对象绑定到该租户当时的 current epoch。租户、对象和 epoch 标识均为非空字符串，重复注册必须拒绝。
- `beginRotation(tenant, newEpoch)` 开始唯一活动轮换。旧 current epoch 进入 retiring，目标 epoch 立即成为 current，并为开始轮换时仍使用旧 epoch 的每个对象建立一项任务。轮换开始必须具备原子性，任何容量或状态错误都不得留下部分状态或审计记录。
- `claim(worker)` 按稳定、可复现的顺序领取 pending 任务，返回 `taskId`、租户、对象、源/目标 epoch、单调递增 fence 和 deadline；无可领取任务时返回 `undefined`。同一 worker 同时只能持有一个任务。
- `renew(worker, taskId, fence)` 仅允许当前未过期持有者续租；`complete(worker, taskId, fence)` 仅允许当前未过期持有者完成，并将对象切换到目标 epoch。错误 worker、旧 fence、过期 lease 或不匹配状态必须拒绝且不改变状态或日志。
- `drive()` 是 lease 过期生效的唯一推进点。它按确定顺序释放到期 lease 并将任务重新置为 pending；重新领取同一任务必须获得更大的 fence。
- `retire(tenant, epoch)` 只可退役该租户当前活动轮换的旧 epoch，并且必须同时满足对象目录不再引用它、相关任务全部完成且无活动 lease。退役后该轮换结束。
- 提供 `status(tenant)`、`objectEpoch(tenant, objectId)`、`tasks(tenant?)`、`currentEpoch(tenant)` 查询；查询结果不得暴露可修改内部状态。
- `journal()` 返回按连续 `seq` 排列的只追加记录副本，记录成功的外部状态变化及发生时间。`KeyRoll.fromJournal(config, journal)` 必须校验并按原记录精确重放，恢复相同的查询状态、任务顺序、lease/fence 后续行为和完全相同的 journal；非法、乱序或相对传入 clock 来自未来的日志必须拒绝。
- 容量限制为全局上限。所有可观察顺序必须确定，失败操作不得追加 WAL。

## 约束
- 不要修改 `tests/`。
- 不得添加外部依赖，不得使用真实定时器、网络、数据库、文件持久化、`Date.now` 或 `Math.random`。
- 时间只能来自注入的 `VirtualClock`；只有显式 API 调用可以推进业务状态。
- 实现须跨多个职责模块维护实时真相、任务/租约、退役屏障与审计重放，不能把全部状态机压进单个文件。

## 验收
`npm test` 与 `npm run build` 全部通过。
