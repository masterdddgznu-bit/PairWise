## 简述
实现一个确定性的浇口井协调器。系统在纯内存中同时维护熔次登记、砂型激冷窗口与回冷块，以及浇注/回冷义务的租约；入模必须对上当前激冷窗口，浇注后砂型会升温。

## 需求
- 从 `src/index.ts` 导出 `SprueWell`、`SprueWellError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxLots`（默认 16）、`maxFlasks`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialRest`（默认 0）；除 `initialRest` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 熔次以非空 id 登记 `heat` / `mass` / `readyAt`。新 id 占容量；已存在且未入模可改字段并保留首次登记序与冻结状态。冻结熔次仍占登记容量，不能入模或出模。在模内不得取消或改写。
- 砂型以初始激冷、接纳跨度、一次回冷量与锅寿打开，激冷初始等于打开值。每型最多同时上一炉。入模时须 `chill <= heat <= chill + span`。浇注把该炉 `mass` 累加进激冷。出模须已经浇注。回冷按一次回冷量把激冷拉回打开值（不足一块则贴齐），且型上不能有熔次。浇注须在入模后的锅寿内完成。
- 操作员以租约与单调 fence 领取浇注或回冷义务；陈旧 fence、过期租约或错误工人在失败路径不得改激冷或扣信用。`grantRest` 增加回冷信用，每次回冷耗 1 点。
- `peekFill(flaskId)` 给出该型下一炉可考虑入模的熔次，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、热度、质量、激冷、跨度、回冷量、锅寿、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 与初始激冷允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
