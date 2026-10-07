## 简述
实现一个确定性的窑车棚板协调器。系统在纯内存中同时维护坯件登记、窑车气氛窗口与通风块，以及烧成/通风义务的租约；上车必须对上当前气氛窗口，烧成后气氛会升高。

## 需求
- 从 `src/index.ts` 导出 `BatStack`、`BatStackError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxLots`（默认 16）、`maxCars`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialVent`（默认 0）；除 `initialVent` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 坯件以非空 id 登记 `glaze` / `load` / `readyAt`。新 id 占容量；已存在且未上车可改字段并保留首次登记序与冻结状态。冻结坯件仍占登记容量，不能上车或下车。在车上不得取消或改写。
- 窑车以初始气氛、接纳跨度、一次通风量与层容量打开，气氛初始等于打开值。车上按层叠放，不得超过层容量。上车时须 `atm <= glaze <= atm + span`。烧成把当前最上层的 `load` 累加进气氛。下车必须是最上层且已经烧成。通风按一次通风量把气氛拉回打开值（不足一块则贴齐），且车上不能有坯。
- 操作员以租约与单调 fence 领取烧成或通风义务；陈旧 fence、过期租约或错误工人在失败路径不得改气氛或扣信用。`grantVent` 增加通风信用，每次通风耗 1 点。
- `peekLoad(carId)` 给出该车下一块可考虑上车的坯，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、釉温、负荷、气氛、跨度、通风量、层容量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 与初始气氛允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
