请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 Epoch-Based Reclamation 任务：若干工作线程（默认 3）可 `pin`/`unpin` 当前全局世代；`retire` 把对象挂到 retire 列表，只有当没有任何线程仍钉在 **小于等于** 该对象 retire 世代上时才可回收；`bump` 推进全局 epoch；可选 `reclaimDelay` 要求对象在首次可回收之后再等待 VirtualClock 时间才真正释放。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过注入的 `VirtualClock` 推进。

语义约束（测试会覆盖）：
- 构造：`new EpochGc({ clock, threadCount=3, reclaimDelay=0 })`；线程 id 为 `0 .. threadCount-1`；全局 epoch 从 `0` 起
- `pin(threadId)`：该线程必须尚未 pin，将其钉在 **当前全局 epoch**，返回该 epoch；非法 threadId 抛 `InvalidThreadError`；重复 pin 抛 `AlreadyPinnedError`
- `unpin(threadId)`：若处于 pin 则解除并返回 true，否则 false；非法 id 抛 `InvalidThreadError`
- `currentEpoch()` / `minPinned()`：后者为所有 **仍 pin** 的世代最小值；无人 pin 时返回 `null`（不阻塞回收）
- `bump()`：全局 epoch +1，不影响已 pin 线程记录的世代
- `retire(id)`：以 **当时全局 epoch** 入队；同一 `id` 若仍在 pending 中则抛 `DuplicateRetireError`
- 对象可回收当且仅当：不存在线程满足 `pinnedEpoch !== null && pinnedEpoch <= retiredEpoch`
- `reclaim()`：回收所有已满足条件且（若 `reclaimDelay>0`）自 **首次变为可回收** 起 `clock.now() >= eligibleAt + reclaimDelay` 的对象；返回 id 数组，**按 retire 先后**；已回收 id 不得再出现
- `tick()`：`clock.advance(1)` 然后 `reclaim()`
- `unregister(threadId)`：线程崩溃/退出——强制 unpin 并从注册表移除，之后该 id 的 pin/unpin 均抛 `InvalidThreadError`；不再阻塞回收
- `pendingCount()`：尚未 reclaim 的 retire 条数

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — RetireRecord 等
- `src/errors.ts` — 错误类型
- `src/thread_table.ts` — 线程注册 / pin 表
- `src/epoch.ts` — 全局 epoch 与 minPinned
- `src/retire_list.ts` — retire 队列
- `src/reclaimer.ts` — 可回收判定与 delay
- `src/epoch_gc.ts` — `EpochGc` 门面
- `src/index.ts` — 统一导出

对外 API 以 `EpochGc` / `VirtualClock` / 错误类型为准（见各模块导出）。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
