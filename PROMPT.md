## 简述
实现一个确定性的包垛压仓协调器。系统在纯内存中同时维护包件登记、仓内已填体积与松仓块，以及压包/松仓义务的租约；入仓必须对上剩余库容，压包后已填体积升高。

## 需求
- 从 `src/index.ts` 导出 `BaleBin`、`BaleBinError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxBales`（默认 16）、`maxBins`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialShake`（默认 0）；除 `initialShake` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 包件以非空 id 登记 `bulk` / `readyAt`。新 id 占容量；已存在且未入仓可改字段并保留首次登记序与冻结状态。冻结包件仍占登记容量，不能入仓或出仓。在仓内不得取消或改写。
- 压仓以库容与一次松仓量打开，已填体积初始为 0。每仓最多同时上一包。入仓时该包 `bulk` 不得超过剩余库容。压包把该包 `bulk` 累加进已填体积。出仓须已经压包。松仓按一次松仓量扣减已填体积（不足一块则清零），且仓上不能有包。
- 操作员以租约与单调 fence 领取压包或松仓义务；陈旧 fence、过期租约或错误工人在失败路径不得改已填体积或扣信用。`grantShake` 增加松仓信用，每次松仓耗 1 点。
- `peekLoad(binId)` 给出该仓下一包可考虑入仓的包件，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、体积、库容、已填、松仓量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
