## 简述

实现进程内 HLC 打点发件箱：各副本维护混合逻辑钟，消息缓冲至 merge-watermark（frontier）覆盖后方可因果投递；支持命名检查点与可恢复 WAL，使 live 状态与 journal 双真相并可用 `fromJournal` 还原。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`Hlcout`、`Hlcout.fromJournal`，以及错误类 `HlcoutError` 与至少 `InvalidConfigError` / `InvalidArgError` / `CapacityError` / `StateError` / `UnknownError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new Hlcout({ clock, maxReplicas?, maxPending?, maxChk? })
```

- `maxReplicas` 默认 8、`maxPending` 默认 64、`maxChk` 默认 16；均为整数 `>= 1`。
- 非法配置 → `InvalidConfigError`。

**副本与 HLC**

- `register(replica)`：登记生产者副本；空名 → `InvalidArgError`；已登记 → `StateError`；触达 `maxReplicas` → `CapacityError`。
- 每副本维护 HLC `{ pt, lc }`（非负整数）。本地 `stamp` 按经典 HLC send/tick 规则结合 `VirtualClock.now` 分配新戳，且该副本时钟单调不降。
- `observe(replica, remoteHlc)`：按经典 HLC receive/merge 把远端戳并入本地时钟，**不**入队消息；非法 HLC → `InvalidArgError`；未登记 → `UnknownError`。
- HLC 全序为先比 `pt` 再比 `lc`。可查询 `clockOf(replica)` / `replicas()`。

**缓冲与 frontier**

- `stamp(replica, payload)`：打点并进入 pending；成功返回所分配 HLC。pending 触达 `maxPending` → `CapacityError`，且失败不得留下时钟推进或 WAL 记录。
- `advanceFrontier(replica, hlc)`：提高该副本 merge-watermark；必须对已有 frontier 单调不降（相等允许）；回退 → `StateError` 且不改状态；未登记 → `UnknownError`。
- 某 pending 消息可投递，当且仅当其来源副本已有 frontier，且消息 HLC `<=` 该 frontier。
- `deliver(max?)`：取出当前可投递消息，按因果序（HLC，再 replica 名，再 msgId）返回并移入 delivered；`max` 限制本批条数；非法 `max` → `InvalidArgError`。可查询 `pending()` / `delivered()` / `frontierOf(replica)`。

**检查点与 GC**

- `checkpoint(name)`：把**当前已投递** msgId 集合快照记到名下；同名覆盖不额外占容量；新名触达 `maxChk` → `CapacityError`。`readChk(name)` 读快照；未知名 → `UnknownError`。
- `drive()`：仅当存在命名检查点时，删除 delivered 历史中落在**所有**检查点快照交集里的 id；无检查点则不删；不得动 pending。

**WAL 双真相**

- 成功变更必须追加 journal；失败抛错不得追加。
- `journal()` 返回只读拷贝。
- `Hlcout.fromJournal(clock, opts, entries)` 重放后，已登记副本、各时钟、frontier、pending/delivered、检查点与后续操作行为须与源实例可观测状态一致。

正确性以不变量与测试为准。宜拆多模块，不指定内部文件名。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
