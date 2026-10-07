## 简述
实现一个确定性的矿箕装笼协调器。系统在纯内存中同时维护矿块登记、箕内已用承重与倾卸块，以及起吊/倾卸义务的租约；入箕必须对上剩余承重，起吊后已用承重升高。

## 需求
- 从 `src/index.ts` 导出 `OreSkip`、`OreSkipError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxChunks`（默认 16）、`maxSkips`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialDump`（默认 0）；除 `initialDump` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 矿块以非空 id 登记 `mass` / `readyAt`。新 id 占容量；已存在且未入箕可改字段并保留首次登记序与冻结状态。冻结矿块仍占登记容量，不能入箕或出箕。在箕内不得取消或改写。
- 箕以承重上限与一次倾卸量打开，已用承重初始为 0。每箕最多同时上一块。入箕时该块 `mass` 不得超过剩余承重。起吊把该块 `mass` 累加进已用承重。出箕须已经起吊。倾卸按一次倾卸量扣减已用承重（不足一块则清零），且箕上不能有块。
- 操作员以租约与单调 fence 领取起吊或倾卸义务；陈旧 fence、过期租约或错误工人在失败路径不得改已用承重或扣信用。`grantDump` 增加倾卸信用，每次倾卸耗 1 点。
- `peekLoad(skipId)` 给出该箕下一块可考虑入箕的矿块，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、质量、承重、已用、倾卸量、信用、fence 必须为安全非负整数；要求正数的字段不得为零（`readyAt` 允许 0）；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
