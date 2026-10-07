## 简述
实现一个确定性的桶板配宽协调器。系统在纯内存中同时维护桶板登记、桶上已用宽度与锛削块，以及入座/锛削义务的租约；上桶必须对上剩余宽度，入座后已用宽度升高。

## 需求
- 从 `src/index.ts` 导出 `HoopStave`、`HoopStaveError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxStaves`（默认 16）、`maxCasks`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialAdze`（默认 0）；除 `initialAdze` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 桶板以非空 id 登记 `width` / `readyAt`。新 id 占容量；已存在且未上桶可改字段并保留首次登记序与冻结状态。冻结桶板仍占登记容量，不能上桶或卸下。在桶上不得取消或改写。
- 桶以宽度上限、一次锛削量与箍距打开，已用宽度初始为 0。每桶最多同时上一块。上桶时该板 `width` 不得超过剩余宽度。入座把该板 `width` 累加进已用宽度。卸下须已经入座。锛削按一次锛削量扣减已用宽度（不足一块则清零），且桶上不能有板。
- 操作员以租约与单调 fence 领取入座或锛削义务；陈旧 fence、过期租约或错误工人在失败路径不得改已用宽度或扣信用。`grantAdze` 增加锛削信用，每次锛削耗 1 点。
- `peekLoad(caskId)` 给出该桶下一块可考虑上桶的桶板，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、宽度、已用、箍距、锛削量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
