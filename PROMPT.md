## 简述
实现一个确定性的烘床布协调器。系统在纯内存中同时维护花批登记、烘床通风窗口与回风块，以及焙干/回风义务的租约；上布必须对上当前通风窗口，入床后水分随时间抽干，焙干后通风会增强。

## 需求
- 从 `src/index.ts` 导出 `OastCloth`、`OastClothError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxLots`（默认 16）、`maxFloors`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialRest`（默认 0）；除 `initialRest` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 花批以非空 id 登记 `leaf` / `wet` / `load` / `readyAt`。新 id 占容量；已存在且未上布可改字段并保留首次登记序与冻结状态。冻结花批仍占登记容量，不能上布或下布。在布上不得取消或改写。
- 烘床以初始通风、接纳跨度、单位抽湿、一次回风量与焙干水分上限打开，通风初始等于打开值。每床最多同时上一批。上布时须 `draft <= leaf <= draft + span`。焙干把该批 `load` 累加进通风。下布须已经焙干。回风按一次回风量把通风拉回打开值（不足一块则贴齐），且床上不能有花。
- 操作员以租约与单调 fence 领取焙干或回风义务；陈旧 fence、过期租约或错误工人在失败路径不得改通风或扣信用。`grantRest` 增加回风信用，每次回风耗 1 点。
- `peekLoad(floorId)` 给出该床下一批可考虑上布的花，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、叶量、水分、负荷、通风、跨度、抽湿、回风量、水分上限、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 与初始通风允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
