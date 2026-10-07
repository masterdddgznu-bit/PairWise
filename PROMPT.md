## 简述
实现一个确定性的退火网带协调器。系统在纯内存中同时维护料块登记、网带芯温窗口与回温块，以及退火/回温义务的租约；上带必须对上当前芯温半宽窗，退火后芯温会按料块质量被拉动。

## 需求
- 从 `src/index.ts` 导出 `LehrBelt`、`LehrBeltError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxGathers`（默认 16）、`maxZones`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialBleed`（默认 0）；除 `initialBleed` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 料块以非空 id 登记 `setpoint` / `mass` / `readyAt`。新 id 占容量；已存在且未上带可改字段并保留首次登记序与冻结状态。冻结料块仍占登记容量，不能上带或出带。在带上不得取消或改写。
- 退火带以环境温度、接纳半宽、一次回温步长与最短均热打开，芯温初始等于环境温度。每带最多同时上一块料。上带时须 `coreTemp - band <= setpoint <= coreTemp + band`。退火把芯温按该块 `mass` 向设定点挪动（设定点不低于芯温则加上质量，否则减去质量）。出带须已经完成退火。回温按步长把芯温拉向环境温度（不足一步则贴齐），且带上不能有料。
- 操作员以租约与单调 fence 领取退火或回温义务；陈旧 fence、过期租约或错误工人在失败路径不得改芯温或扣信用。`grantBleed` 增加回温信用，每次回温耗 1 点。
- `peekLoad(zoneId)` 给出该带下一块可考虑上带的料，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、设定点、质量、芯温、半宽、回温步长、均热、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt`、环境温度与最短均热允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
