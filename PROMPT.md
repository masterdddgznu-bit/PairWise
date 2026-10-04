## 简述

实现进程内双端确认写：对每个 key 发起写入后，必须分别拿到 A、B 两侧的 ack 才算可见；任一侧超时则整笔作废；新写入会抬高 fence，旧 fence 的迟到 ack 必须被拒绝。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`TwinAck`，以及错误类 `TwinAckError` 和至少 `InvalidConfigError` / `InvalidWriteError` / `FenceError` / `UnknownWriteError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new TwinAck({ clock, ackTimeoutMs, maxInflightPerKey?: number })
```

- `ackTimeoutMs >= 1`；`maxInflightPerKey` 默认 1、`>= 1`。非法配置抛 `InvalidConfigError`。

侧别：`"A" | "B"`。

`write(key, value): { writeId: number; fence: number }`

- `key` 非空字符串，否则 `InvalidWriteError`。
- 该 key 当前 **未完成且未作废** 的 in-flight 数量已达 `maxInflightPerKey` → `InvalidWriteError`。
- 分配全局递增 `writeId`（从 1）与该 key 的递增 `fence`（从 1）。
- 记录 `value`、`deadline = now + ackTimeoutMs`，两侧均未 ack。
- 同一 key 上后来的 write 使用更大 fence；较早 in-flight 仍可继续 ack，但若先完成的是更新 fence，可见值以 **已可见的最高 fence** 为准（见 `get`）。

`ack(writeId, side, fence): boolean`

- 未知 `writeId` → `UnknownWriteError`。
- 该笔已作废或已可见完成 → `false`。
- `fence` 与该笔记录不一致 → `FenceError`。
- `side` 不是 `"A"`/`"B"` → `InvalidWriteError`。
- 该侧重复 ack → `false`（不抛错）。
- 首次对该侧 ack 成功 → `true`；若此刻 A、B 都已 ack，则该笔变为 **可见**（committed），并从 in-flight 移除（仍保留在可见历史里供 `get`）。

`cancel(writeId): boolean`

- 未知 `UnknownWriteError`。
- 已可见或已作废 → `false`。
- 否则标作废并 `true`（两侧未齐的进度丢掉）。

`drive()`：

1. 所有仍 in-flight 且 `now >= deadline` 的写入作废。
2. 返回 `{ timedOut: number[] }` 本轮新作废的 `writeId` 升序。

查询：

- `get(key): { value: unknown; fence: number } | undefined`  
  返回该 key **已可见** 写入中 fence 最大的那笔；没有可见写入则 `undefined`。作废/未齐的不算。
- `inflightOf(key): number[]` 该 key 当前 in-flight 的 `writeId` 升序。
- `statusOf(writeId): 'inflight' | 'visible' | 'timedout' | 'cancelled'`  
  未知 `UnknownWriteError`。
- `ackedSides(writeId): Array<'A' | 'B'>` 已 ack 侧别按 A 再 B；未知 `UnknownWriteError`。已作废/可见后仍返回作废或完成前已记录的 ack 侧（可见完成时通常为 `['A','B']`）。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
