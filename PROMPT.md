## 简述
实现一个确定性的船闸厢室协调器。系统在纯内存中同时维护待闸船舶登记、厢室水位与剩余厢长，以及灌厢/泄厢义务的租约，进出闸与升降必须能对上水位和容量。

## 需求
- 从 `src/index.ts` 导出 `PoundLock`、`PoundLockError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxCraft`（默认 16）、`maxChambers`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialRise`（默认 0）；除 `initialRise` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 船舶以非空 id 登记 `draft` / `length` / `readyAt` / `dest`（`up` 或 `down`）。新 id 占容量；已存在且未进厢可改字段并保留首次登记序与冻结状态。冻结船仍占登记容量，不能进出。在厢内不得取消或改写。
- 厢室以低/高两个水位与厢长打开，初始在低水位。上行船只能在低水位进厢、高水位出厢；下行相反。吃水不得超过进厢时的当前水位；剩余厢长不够则不能进。
- 灌厢把水位从低提到高，泄厢相反；每次各耗 1 点升程信用。`grantRise` 增加信用。操作员以租约与单调 fence 领取灌/泄义务；陈旧 fence、过期租约或错误工人在失败路径不得改水位或扣信用。
- `peekAdmit(chamberId)` 给出该厢下一艘可考虑接纳的船，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、吃水、船长、水位、信用、fence 必须为安全非负整数；要求正数的字段不得为零；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
