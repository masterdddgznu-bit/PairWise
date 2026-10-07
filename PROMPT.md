## 简述
实现一个确定性的开沟播种协调器。系统在纯内存中同时维护种子批登记、犁刀间隙窗口与修刃块，以及下种/修刃义务的租约；上沟必须对上当前犁刀间隙，下种后间隙会因磨损而变宽。

## 需求
- 从 `src/index.ts` 导出 `CoulterBed`、`CoulterBedError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxLots`（默认 16）、`maxBeds`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialDress`（默认 0）；除 `initialDress` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 种子批以非空 id 登记 `caliper` / `load` / `readyAt`。新 id 占容量；已存在且未上沟可改字段并保留首次登记序与冻结状态。冻结批次仍占登记容量，不能上沟或下沟。在沟上不得取消或改写。
- 苗床以初始间隙、接纳跨度与一次修刃量打开，间隙初始等于打开值。每床最多同时上一批。上沟时须 `gap <= caliper <= gap + span`。下种把该批 `load` 累加进间隙。下沟须已经下种。修刃按一次修刃量把间隙拉回打开值（不足一块则贴齐打开值），且床上不能有批。
- 操作员以租约与单调 fence 领取下种或修刃义务；陈旧 fence、过期租约或错误工人在失败路径不得改间隙或扣信用。`grantDress` 增加修刃信用，每次修刃耗 1 点。
- `peekMount(bedId)` 给出该床下一批可考虑上沟的种子，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、口径、负荷、间隙、跨度、修刃量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 与初始间隙允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
