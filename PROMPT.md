## 简述
实现一个确定性的萌生林伐区协调器。系统在纯内存中同时维护林分登记、伐床堆材与运力，以及采伐/外运义务的租约；上伐必须对上轮伐年龄和剩余堆场。

## 需求
- 从 `src/index.ts` 导出 `StoolBed`、`StoolBedError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxStands`（默认 16）、`maxBeds`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialCart`（默认 0）；除 `initialCart` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 林分以非空 id 登记 `plantedAt` / `rotation` / `stools`。新 id 占容量；已存在且未上伐可改字段并保留首次登记序与冻结状态。冻结林分仍占登记容量，不能上伐或下伐。在伐床上不得取消或改写。
- 伐床以堆场库容与一次运力打开，初始堆材为 0。每床最多同时上一片林分。上伐时当前时刻须达到 `plantedAt + rotation`，且 `stools` 不得超过剩余堆场。采伐把该片凳木累加进堆材，并把 `plantedAt` 改写为当前时刻。下伐须已经完成采伐。外运按一次运力扣减当前堆材（不足一块则清零），且床上不能有林分。
- 操作员以租约与单调 fence 领取采伐或外运义务；陈旧 fence、过期租约或错误工人在失败路径不得改堆材、种植时刻或扣信用。`grantCart` 增加外运信用，每次外运耗 1 点。
- `peekFell(bedId)` 给出该床下一片可考虑上伐的林分，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、轮伐、凳木、库容、运力、堆材、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`plantedAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
