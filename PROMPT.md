## 简述
实现一个确定性的垫梁配跨协调器。系统在纯内存中同时维护垫梁登记、台上已用跨度与修整块，以及抬升/修整义务的租约；上台必须对上剩余跨度，抬升后已用跨度升高。

## 需求
- 从 `src/index.ts` 导出 `SillLift`、`SillLiftError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxSills`（默认 16）、`maxBeds`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialDress`（默认 0）；除 `initialDress` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 垫梁以非空 id 登记 `span` / `readyAt`。新 id 占容量；已存在且未上台可改字段并保留首次登记序与冻结状态。冻结垫梁仍占登记容量，不能上台或卸下。在台上不得取消或改写。
- 台以跨度上限、一次修整量与标称净空打开，已用跨度初始为 0。每台最多同时上一根。上台时该梁 `span` 不得超过剩余跨度。抬升把该梁 `span` 累加进已用跨度。卸下须已经抬升。修整按一次修整量扣减已用跨度（不足一块则清零），且台上不能有梁。
- 操作员以租约与单调 fence 领取抬升或修整义务；陈旧 fence、过期租约或错误工人在失败路径不得改已用跨度或扣信用。`grantDress` 增加修整信用，每次修整耗 1 点。
- `peekLoad(bedId)` 给出该台下一根可考虑上台的垫梁，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、跨度、已用、标称、修整量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
