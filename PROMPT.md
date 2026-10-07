## 简述
实现一个确定性的舌接协调器。系统在纯内存中同时维护接穗登记、砧木登记与床位树液，以及愈合/回灌义务的租约；上床必须同时对上口径松弛和当前树液。

## 需求
- 从 `src/index.ts` 导出 `WhipGraft`、`WhipGraftError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxScions`（默认 16）、`maxStocks`（默认 16）、`maxBeds`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialIrrigate`（默认 0）；除 `initialIrrigate` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 接穗以非空 id 登记 `caliper` / `demand` / `readyAt`；砧木以非空 id 登记 `caliper` / `readyAt`。新 id 占各自容量；已存在且未上床可改字段并保留首次登记序与冻结状态。冻结只作用于接穗，冻结接穗仍占容量，不能上床或下床。在床上不得取消或改写。
- 苗床以口径松弛、树液上限与一次回灌量打开，树液初始等于上限。每床最多同时上一对接穗与砧木。上床时接穗与砧木口径差的绝对值不得超过松弛，且当前树液不得低于该接穗需液。愈合把该接穗 `demand` 从树液扣掉。下床须已经愈合。回灌按步长补树液（不超过上限；不足一步则贴齐上限），且床上不能有株。
- 操作员以租约与单调 fence 领取愈合或回灌义务；陈旧 fence、过期租约或错误工人在失败路径不得改树液或扣信用。`grantIrrigate` 增加回灌信用，每次回灌耗 1 点。
- `peekBind(bedId)` 给出该床下一对可考虑上床的接穗与砧木，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、口径、需液、松弛、树液、回灌量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 与树液上限允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
