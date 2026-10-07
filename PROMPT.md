## 简述
实现一个确定性的沉砂池协调器。系统在纯内存中同时维护暴雨事件登记、池室淤积与堰高，以及落淤/冲淤义务的租约；入池与落淤必须对上剩余库容和颗粒能否过堰。

## 需求
- 从 `src/index.ts` 导出 `SiltTrap`、`SiltTrapError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxStorms`（默认 16）、`maxBays`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialFlush`（默认 0）；除 `initialFlush` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 暴雨以非空 id 登记 `load` / `grit` / `readyAt`。新 id 占容量；已存在且未入池可改字段并保留首次登记序与冻结状态。冻结事件仍占登记容量，不能入池或出池。在池内不得取消或改写。
- 池室以库容与堰高打开，初始淤积为 0。每池最多同时接纳一场暴雨。入池时 `grit` 不得超过堰高，且 `load` 不得超过剩余库容。落淤把该场 `load` 累加进淤积；出池须已经落淤。冲淤按堰高扣减当前淤积（不足一堰则清零），且池上不能有暴雨。
- 操作员以租约与单调 fence 领取落淤或冲淤义务；陈旧 fence、过期租约或错误工人在失败路径不得改淤积或扣信用。`grantFlush` 增加冲淤信用，每次冲淤耗 1 点。
- `peekAdmit(bayId)` 给出该池下一场可考虑接纳的暴雨，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、负荷、粒径、库容、堰高、淤积、信用、fence 必须为安全非负整数；要求正数的字段不得为零；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
