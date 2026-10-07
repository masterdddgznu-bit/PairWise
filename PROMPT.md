## 简述
实现一个确定性的起爆回路协调器。系统在纯内存中同时维护雷管登记、回路已用药量与抑爆块，以及起火/抑爆义务的租约；接入必须对上剩余药量，起火后已用药量升高。

## 需求
- 从 `src/index.ts` 导出 `SquibLine`、`SquibLineError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxSquibs`（默认 16）、`maxLines`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialDamp`（默认 0）；除 `initialDamp` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 雷管以非空 id 登记 `grain` / `readyAt` / `dueAt`。新 id 占容量；已存在且未接入可改字段并保留首次登记序与冻结状态。冻结雷管仍占登记容量，不能接入或拆下。在回路上不得取消或改写。
- 回路以药量上限与一次抑爆量打开，已用药量初始为 0。每回路最多同时上一发。接入时该发 `grain` 不得超过剩余药量。起火把该发 `grain` 累加进已用药量。拆下须已经起火。抑爆按一次抑爆量扣减已用药量（不足一块则清零），且回路上不能有雷管。
- 操作员以租约与单调 fence 领取起火或抑爆义务；陈旧 fence、过期租约或错误工人在失败路径不得改已用药量或扣信用。`grantDamp` 增加抑爆信用，每次抑爆耗 1 点。
- `peekArm(lineId)` 给出该回路下一发可考虑接入的雷管，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、药量、上限、已用、抑爆量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 与 `dueAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
