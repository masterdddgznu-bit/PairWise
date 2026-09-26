请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内分层 Timing Wheel 任务：定时器用唯一 `id` 调度到某绝对到期时刻；`advance`/`tick` 把 `VirtualClock` 推到目标时间并按到期顺序触发回调收集；多层轮（默认 3 层，每层 `slotCount` 个槽、槽宽按层指数放大）在指针跨越时把高层到期桶 cascade 到更低层；同 `id` 再次 `schedule` 覆盖旧到期；`cancel` 使未触发的定时器失效。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过注入的 `VirtualClock` 推进。

语义约束（测试会覆盖）：
- 构造：`new TimerWheel({ clock, slotCount=8, levels=3, tickMs=1 })`；第 0 层槽宽=`tickMs`，第 i 层槽宽=`tickMs * slotCount^i`
- `schedule(id, delayMs, payload)`：`deadline = clock.now() + delayMs`；若 `delayMs < 0` 抛 `InvalidDelayError`；若超出轮能表示的最大延迟（各层覆盖之和）抛 `DelayTooLargeError`；同 id 已存在则先等效 cancel 再插入
- `cancel(id)`：存在则移除并返回 true，否则 false；已触发过的 id 再 cancel 返回 false
- `advance(toTime)`：要求 `toTime >= clock.now()`，否则抛 `InvalidAdvanceError`；将 clock 推进到 `toTime`，期间每经过一个第 0 层 tick 就处理指针前进与 cascade，收集所有 `deadline <= toTime` 的定时器；返回值按 **deadline 升序**，deadline 相同则按 **schedule 调用先后（seq）** 稳定排序；每条为 `{ id, payload, deadline }`
- `tick()`：等价于 `advance(clock.now() + tickMs)`
- cascade：当第 i 层指针前进离开某槽时，该槽内任务必须按剩余延迟重新插入到更低层（最终落到第 0 层才能触发）
- 已触发的定时器不得再次触发；cancel 后不得触发

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — Timer / Fired 等
- `src/slot.ts` — 单槽链表/数组
- `src/wheel_level.ts` — 单层轮（指针、加槽、推进一格）
- `src/cascade.ts` — 跨层重挂
- `src/timer_wheel.ts` — `TimerWheel` 门面
- `src/errors.ts` — 错误类型
- `src/index.ts` — 统一导出

对外 API 以 `TimerWheel` / `VirtualClock` / 错误类型为准（见各模块导出）。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
