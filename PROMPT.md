## 简述
实现一个确定性的淬火池协调器。系统在纯内存中同时维护炉次登记、油温窗口与回冷块，以及入淬/回冷义务的租约；入池必须对上当前油温窗口，入淬后油温会升高。

## 需求
- 从 `src/index.ts` 导出 `QuenchPit`、`QuenchPitError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxHeats`（默认 16）、`maxPits`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialCool`（默认 0）；除 `initialCool` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 炉次以非空 id 登记 `austenite` / `load` / `readyAt`。新 id 占容量；已存在且未入池可改字段并保留首次登记序与冻结状态。冻结炉次仍占登记容量，不能入池或出池。在池内不得取消或改写。
- 淬火池以初始油温、窗口跨度与一次回冷量打开。每池最多同时上一炉。入池时须 `oilTemp <= austenite <= oilTemp + span`。入淬把该炉 `load` 累加进油温。出池须已经入淬。回冷按一次回冷量扣减油温（不足一块则回到打开时的初始油温），且池上不能有炉次。
- 操作员以租约与单调 fence 领取入淬或回冷义务；陈旧 fence、过期租约或错误工人在失败路径不得改油温或扣信用。`grantCool` 增加回冷信用，每次回冷耗 1 点。
- `peekDip(pitId)` 给出该池下一炉可考虑入池的炉次，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、奥氏体温度、热负荷、油温、跨度、回冷量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 与初始油温允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
