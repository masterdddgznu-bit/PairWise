## 简述
实现一个确定性的先行闸门协调器。系统在纯内存中同时维护工件登记、闸内已用厚度与清闸块，以及入闸/清闸义务的租约；入闸必须对上剩余厚度，入闸作业后已用厚度升高。

## 需求
- 从 `src/index.ts` 导出 `ForeLock`、`ForeLockError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxPieces`（默认 16）、`maxGates`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialRake`（默认 0）；除 `initialRake` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 工件以非空 id 登记 `mass` / `readyAt`，并可带可选 `after`（另一件 id）。新 id 占容量；已存在且未入闸可改字段并保留首次登记序与冻结状态。冻结工件仍占登记容量，不能入闸或卸下。在闸内不得取消或改写。
- 闸门以厚度上限与一次清闸量打开，已用厚度初始为 0。每闸最多同时上一件。入闸时该件 `mass` 不得超过剩余厚度。入闸作业把该件 `mass` 累加进已用厚度。卸下须已经完成入闸作业。清闸按一次清闸量扣减已用厚度（不足一块则清零），且闸上不能有件。
- 操作员以租约与单调 fence 领取入闸或清闸义务；陈旧 fence、过期租约或错误工人在失败路径不得改已用厚度或扣信用。`grantRake` 增加清闸信用，每次清闸耗 1 点。
- `peekLoad(gateId)` 给出该闸下一件可考虑入闸的工件，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、厚度、已用、清闸量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
