## 简述
实现一个确定性的辉度锻架协调器。系统在纯内存中同时维护钢坯登记、架上已用承重与淬火块，以及出架/淬火义务的租约；入架必须对上剩余承重，出架后已用承重升高。

## 需求
- 从 `src/index.ts` 导出 `GlowRack`、`GlowRackError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxBillets`（默认 16）、`maxRacks`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialQuench`（默认 0）；除 `initialQuench` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 钢坯以非空 id 登记 `mass` / `heat` / `climb` / `readyAt`。新 id 占容量；已存在且未入架可改字段并保留首次登记序与冻结状态。冻结钢坯仍占登记容量，不能入架或出架。在架上不得取消或改写。
- 锻架以承重上限、一次淬火量与最低辉度打开，已用承重初始为 0。每架最多同时上一块。入架时该块 `mass` 不得超过剩余承重。出架把该块 `mass` 累加进已用承重。卸下须已经出架。淬火按一次淬火量扣减已用承重（不足一块则清零），且架上不能有坯。
- 操作员以租约与单调 fence 领取出架或淬火义务；陈旧 fence、过期租约或错误工人在失败路径不得改已用承重或扣信用。`grantQuench` 增加淬火信用，每次淬火耗 1 点。
- `peekLoad(rackId)` 给出该架下一块可考虑入架的钢坯，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、质量、辉度、爬升、承重、已用、淬火量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 与最低辉度允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
