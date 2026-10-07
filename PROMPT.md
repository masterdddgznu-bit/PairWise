## 简述
实现一个确定性的酸洗槽协调器。系统在纯内存中同时维护工件登记、槽内酸量与槽温窗口，以及酸洗/护浴义务的租约；入槽必须同时对上剩余酸量和当前槽温窗口，酸洗后酸量下降、槽温升高。

## 需求
- 从 `src/index.ts` 导出 `PickleBath`、`PickleBathError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxPieces`（默认 16）、`maxTanks`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialTend`（默认 0）；除 `initialTend` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 工件以非空 id 登记 `alloy` / `scale` / `readyAt`。新 id 占容量；已存在且未入槽可改字段并保留首次登记序与冻结状态。冻结工件仍占登记容量，不能入槽或出槽。在槽内不得取消或改写。
- 酸槽以初始槽温、接纳跨度、酸量上限与一次护浴步长打开，槽温初始等于打开值，酸量初始等于上限。每槽最多同时上一件。入槽时须酸量不少于该件 `scale`，且 `heat <= alloy <= heat + span`。酸洗把该件 `scale` 从酸量扣掉并累加进槽温。出槽须已经酸洗。护浴把酸量补向打开时的上限，或把槽温拉回打开值（不足一步则贴齐），且槽上不能有件。
- 操作员以租约与单调 fence 领取酸洗或护浴义务；陈旧 fence、过期租约或错误工人在失败路径不得改酸量、槽温或扣信用。`grantTend` 增加护浴信用，每次护浴耗 1 点。
- `peekDip(tankId)` 给出该槽下一件可考虑入槽的工件，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、合金温度、氧化皮、槽温、跨度、酸量、步长、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 与初始槽温允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
