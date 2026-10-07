## 简述
实现一个确定性的拉丝台协调器。系统在纯内存中同时维护盘条登记、台面模具寿命，以及拉拔/换模义务的租约；上机与减面必须对上当前线径、目标线径和模具孔。

## 需求
- 从 `src/index.ts` 导出 `DrawBench`、`DrawBenchError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxCoils`（默认 16）、`maxBenches`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialPull`（默认 0）；除 `initialPull` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 盘条以非空 id 登记 `gauge` / `length` / `readyAt` / `aim`。`aim` 必须严格小于 `gauge`。新 id 占容量；已存在且未上机可改字段并保留首次登记序与冻结状态。冻结盘条仍占登记容量，不能上机或下机。在机台上不得取消或改写。
- 台面先打开，再安装一副模具（孔型与剩余寿命）。每台最多同时上一根盘条。上机时模具孔型必须满足 `aim <= orifice < gauge`。拉拔一次把该盘条当前线径写成孔型，并各耗 1 点拉力信用与 1 点模具寿命。达到目标线径后可取下。换模须台面上没有盘条，并换上新的孔型与寿命。
- 操作员以租约与单调 fence 领取拉拔或换模义务；陈旧 fence、过期租约或错误工人在失败路径不得改线径、寿命或扣信用。`grantPull` 增加拉力信用。
- `peekMount(benchId)` 给出该台下一根可考虑上机的盘条，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、线径、长度、孔型、寿命、信用、fence 必须为安全非负整数；要求正数的字段不得为零；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
