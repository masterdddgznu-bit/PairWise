## 简述
实现一个确定性的链板张紧协调器。系统在纯内存中同时维护护索登记、链板张紧带与剩余容量，以及张紧/松弛义务的租约，挂索与摘索必须对上当前张紧与容量。

## 需求
- 从 `src/index.ts` 导出 `ChainPlate`、`ChainPlateError`、`VirtualClock` 及公开类型。构造注入 `VirtualClock`，可选 `maxStays`（默认 16）、`maxPlates`（默认 4）、`maxWork`（默认 16）、`leaseTtl`（默认 5）、`initialHaul`（默认 0）；除 `initialHaul` 允许 0 外均为正安全整数。
- `VirtualClock` 提供 `now()` 与 `advance(ms)`（`ms < 0` 非法）。全部时间只读此时钟。
- 护索以非空 id 登记 `load` / `length` / `readyAt` / `side`（`port` 或 `starboard`）。新 id 占容量；已存在且未挂板可改字段并保留首次登记序与冻结状态。冻结索仍占登记容量，不能挂摘。在板上不得取消或改写。
- 链板以低/高两个张紧值与容量打开，初始在低张紧。左舷索只能在低张紧挂上、高张紧摘下；右舷相反。载荷不得超过挂索时的当前张紧；剩余容量不够则不能挂。
- 张紧把板从低提到高，松弛相反；每次各耗 1 点拖曳信用。`grantHaul` 增加信用。操作员以租约与单调 fence 领取张紧/松弛义务；陈旧 fence、过期租约或错误工人在失败路径不得改张紧或扣信用。
- `peekAttach(plateId)` 给出该板下一根可考虑挂上的索，不改变状态。`snapshot()` 与各列表返回防御性副本。失败操作全部回滚。

## 约束
- 仅 TypeScript，不增加运行时依赖，不修改 `tests/`；禁止网络、数据库、文件系统、`setTimeout`、`Date.now` 和 `Math.random`。
- 时间、载荷、长度、张紧、信用、fence 必须为安全非负整数；要求正数的字段不得为零；标识符为非空字符串。
- 仓库初始没有 `src/`，自行创建源码并从 `src/index.ts` 导出。

## 验收
`npm test` 与 `npm run build` 全部通过。
