## 简述
实现一个确定性的套轭配对协调器。系统在纯内存中同时维护牲畜登记、轭上已承牵引力与歇轭块，以及拉牵/歇轭义务的租约；套轭必须成对且对上剩余承力，拉牵后已承力升高。

## 需求
- 从 `src/index.ts` 导出 `YokePair`、`YokePairError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxBeasts`（默认 16）、`maxYokes`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialRest`（默认 0）；除 `initialRest` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 牲畜以非空 id 登记 `draft` / `readyAt`。新 id 占容量；已存在且未套轭可改字段并保留首次登记序与冻结状态。冻结牲畜仍占登记容量，不能套轭或卸轭。在轭上不得取消或改写。
- 轭以承力上限与一次歇轭量打开，已承力初始为 0。每轭最多同时上一对。套轭时两畜 `draft` 之和不得超过剩余承力。拉牵把该对 `draft` 之和累加进已承力。卸轭须已经拉牵。歇轭按一次歇轭量扣减已承力（不足一块则清零），且轭上不能有畜。
- 操作员以租约与单调 fence 领取拉牵或歇轭义务；陈旧 fence、过期租约或错误工人在失败路径不得改已承力或扣信用。`grantRest` 增加歇轭信用，每次歇轭耗 1 点。
- `peekPair(yokeId)` 给出该轭下一对应考虑套上的一对，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、牵引力、承力、已承、歇轭量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
