## 简述
实现一个确定性的柳条框协调器。系统在纯内存中同时维护条材登记、框上已用宽度与铣削块，以及钉合/铣削义务的租约；上框必须对上剩余宽度，钉合后已用宽度升高。

## 需求
- 从 `src/index.ts` 导出 `WithyBed`、`WithyBedError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxSlats`（默认 16）、`maxFrames`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialMill`（默认 0）；除 `initialMill` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 条材以非空 id 登记 `width` / `readyAt`。新 id 占容量；已存在且未上框可改字段并保留首次登记序与冻结状态。冻结条材仍占登记容量，不能上框或卸下。在框上不得取消或改写。
- 框以宽度上限、一次铣削量与标称步长打开，已用宽度初始为 0。每框最多同时上一根。上框时该条 `width` 不得超过剩余宽度。钉合把该条 `width` 累加进已用宽度。卸下须已经钉合。铣削按一次铣削量扣减已用宽度（不足一块则清零），且框上不能有条。
- 操作员以租约与单调 fence 领取钉合或铣削义务；陈旧 fence、过期租约或错误工人在失败路径不得改已用宽度或扣信用。`grantMill` 增加铣削信用，每次铣削耗 1 点。
- `peekLoad(frameId)` 给出该框下一块可考虑上框的条材，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、宽度、已用、标称、铣削量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
