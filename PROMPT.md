## 简述

实现进程内双流滞后关联：左右两侧按 key 缓冲事件；用事件时间水位决定何时配对输出、何时丢迟到、何时把久等不到对侧的记录以单边形式放出。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`LagJoin`，以及错误类 `LagJoinError` 和至少 `InvalidConfigError` / `InvalidEventError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。说明：本题的 `now()` 表示 **处理时间**；事件自带 `eventTime`。

```ts
new LagJoin({ clock, maxLagMs, waitMs, maxBufferedPerKey?: number })
```

- `maxLagMs >= 0`；`waitMs >= 1`；`maxBufferedPerKey` 默认 8、`>= 1`。非法配置抛 `InvalidConfigError`。

侧别：`"L" | "R"`。

`ingest(side, key, eventTime, value): 'buffered' | 'joined' | 'late' | 'dropped'`

- `side` 必须是 `"L"`/`"R"`；`key` 非空；`eventTime` 为有限数且 `>= 0`。否则 `InvalidEventError`。
- 维护每侧 watermark：该侧已见最大 `eventTime`。全局 watermark `W = min(Lwm, Rwm)`；任一侧尚无事件时该侧 wm 视为 `-Infinity`，此时 `W` 也是 `-Infinity`（不触发基于 W 的清理）。
- 若 `eventTime < W - maxLagMs`（当 `W` 有限时）→ 返回 `'late'`，不入缓冲、不输出。
- 否则尝试与对侧同 key 的 **最早一条**（同 eventTime 按入队处理时间升序，再按到达序号）配对：
  - 配对成功：产出一条 join 结果，返回 `'joined'`。两侧该条都移除。
  - 对侧无可用记录：若该 key 该侧缓冲已达 `maxBufferedPerKey` → 丢弃 **该侧该 key 缓冲中最旧** 一条后入队新事件，返回 `'dropped'`；否则入队，记录 `enqueuedAt = clock.now()`，返回 `'buffered'`。
- 入队序号全局从 1 递增（仅成功入缓冲时分配）。

`drive(): { joined: Join[]; singles: Single[]; droppedLate: number }`

在处理时间推进后调用，做这些事（顺序写死）：

1. 用当前 `W` 丢弃两侧所有 `eventTime < W - maxLagMs` 的缓冲事件，计入 `droppedLate`。
2. 再次尝试所有 key 的配对（每 key 反复配到不能配），产出的 join 按 `(eventTimeL + eventTimeR)` 升序，同等按先完成配对的顺序（稳定：先 L 入队序号更小者优先，再 R 入队序号）。
3. 对仍缓冲的每条记录，若 `clock.now() - enqueuedAt >= waitMs`，以 single 放出（离开缓冲）。`singles` 排序：`eventTime` 升序，同等 `side` L 先于 R，再同等入队序号升序。
4. `joined` 每项：`{ key, left: unknown, right: unknown, eventTimeL, eventTimeR }`。  
   `singles` 每项：`{ key, side, value, eventTime }`。

查询：

- `watermark(): number | null` 当前 `W`；尚不可用时 `null`。
- `bufferedCount(side, key): number`
- `bufferedKeys(side): string[]` 字典序。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 处理时间只来自注入的 `VirtualClock`；事件时间来自 `ingest` 参数。

## 验收

`npm test` 与 `npm run build` 全部通过。
