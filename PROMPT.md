## 简述
实现一个确定性的斜接配长协调器。系统在纯内存中同时维护杆件登记、台上已用长度与刨台块，以及斜接/刨台义务的租约；上台必须对上剩余长度，斜接后已用长度升高。

## 需求
- 从 `src/index.ts` 导出 `ScarfJoin`、`ScarfJoinError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxJoints`（默认 16）、`maxBenches`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialPlane`（默认 0）；除 `initialPlane` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 杆件以非空 id 登记 `mass` / `readyAt`。新 id 占容量；已存在且未上台可改字段并保留首次登记序与冻结状态。冻结杆件仍占登记容量，不能上台或卸下。在台上不得取消或改写。
- 工作台以长度上限、一次刨台量与模数打开，已用长度初始为 0。每台最多同时上一根。上台时该杆 `mass` 不得超过剩余长度。斜接把该杆 `mass` 累加进已用长度。卸下须已经斜接。刨台按一次刨台量扣减已用长度（不足一块则清零），且台上不能有杆。
- 操作员以租约与单调 fence 领取斜接或刨台义务；陈旧 fence、过期租约或错误工人在失败路径不得改已用长度或扣信用。`grantPlane` 增加刨台信用，每次刨台耗 1 点。
- `peekLoad(benchId)` 给出该台下一根可考虑上台的杆件，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、长度、已用、模数、刨台量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
