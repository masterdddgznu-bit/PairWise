## 简述
实现一个确定性的压延配厚协调器。系统在纯内存中同时维护纸页登记、辊上已用厚度与压光块，以及压延/压光义务的租约；上辊必须对上剩余厚度，压延后已用厚度升高。

## 需求
- 从 `src/index.ts` 导出 `NipRoll`、`NipRollError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxSheets`（默认 16）、`maxStacks`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialCrush`（默认 0）；除 `initialCrush` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 纸页以非空 id 登记 `caliper` / `readyAt`。新 id 占容量；已存在且未上辊可改字段并保留首次登记序与冻结状态。冻结纸页仍占登记容量，不能上辊或卸下。在辊上不得取消或改写。
- 辊组以厚度上限、一次压光量与标称厚度打开，已用厚度初始为 0。每组最多同时上一张。上辊时该页 `caliper` 不得超过剩余厚度。压延把该页 `caliper` 累加进已用厚度。卸下须已经压延。压光按一次压光量扣减已用厚度（不足一块则清零），且辊上不能有页。
- 操作员以租约与单调 fence 领取压延或压光义务；陈旧 fence、过期租约或错误工人在失败路径不得改已用厚度或扣信用。`grantCrush` 增加压光信用，每次压光耗 1 点。
- `peekLoad(stackId)` 给出该组下一张可考虑上辊的纸页，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、厚度、已用、标称、压光量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
