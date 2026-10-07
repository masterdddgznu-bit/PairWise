## 简述
实现一个确定性的砌层铺床协调器。系统在纯内存中同时维护板件登记、床上已用厚度与铺砂块，以及铺层/铺砂义务的租约；入床必须对上剩余厚度，铺层后已用厚度升高。

## 需求
- 从 `src/index.ts` 导出 `CourseBed`、`CourseBedError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxPlanks`（默认 16）、`maxBeds`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialSand`（默认 0）；除 `initialSand` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 板件以非空 id 登记 `mass` / `stripe` / `readyAt`。新 id 占容量；已存在且未入床可改字段并保留首次登记序与冻结状态。冻结板件仍占登记容量，不能入床或卸下。在床上不得取消或改写。
- 铺床以厚度上限与一次铺砂量打开，已用厚度初始为 0。每床最多同时上一块。入床时该块 `mass` 不得超过剩余厚度。铺层把该块 `mass` 累加进已用厚度。卸下须已经铺层。铺砂按一次铺砂量扣减已用厚度（不足一块则清零），且床上不能有板。
- 操作员以租约与单调 fence 领取铺层或铺砂义务；陈旧 fence、过期租约或错误工人在失败路径不得改已用厚度或扣信用。`grantSand` 增加铺砂信用，每次铺砂耗 1 点。
- `peekLoad(bedId)` 给出该床下一块可考虑入床的板件，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、厚度、条带、已用、铺砂量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
