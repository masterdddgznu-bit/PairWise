请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内分段 Write-Ahead Log 任务：记录带单调 LSN；`append` 先进入内存缓冲，经 `flush` 或 group-commit 截止后才变 durable；`checkpoint` 写入检查点并截断更早日志；`crash` 丢弃未 flush 缓冲、保留已落盘段；`recover` 从检查点之后重放 data 记录并校验 checksum。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、文件系统持久化或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进；段存储用内存结构即可。

语义约束（测试会覆盖）：
- LSN 从 1 起全局递增；data / checkpoint 记录共用同一 LSN 空间
- `append(payload)` 立即分配 LSN 并进入缓冲，但 `durableLsn()` 在 flush 前不推进；`bufferedCount()` 反映未落盘条数
- group commit：缓冲中最早一条的入队时刻为 T，默认 `groupCommitDelay=10`；当 `clock.now() >= T + delay` 时，`tick()` 必须自动 `flush`；截止前 `tick()` 不落盘
- `flush()` 将当前缓冲按 LSN 升序写入当前段（编码为行），清空缓冲并推进 `durableLsn`
- 段滚动：写入后若当前段累计字节数（各行 length 之和，含换行策略以实现为准，测试用较小 `segmentBytes`）超过阈值，则新开下一段
- `checkpoint()`：先 flush；再追加一条 `kind=checkpoint` 记录；之后 recover 只返回 LSN **大于** 该检查点 LSN 的 data；**严格早于**检查点 LSN 的记录应被截断；检查点记录本身须保留（crash 后仍能读出 `checkpointLsn`）
- `crash()`：丢弃缓冲（这些 LSN 作废，不得再出现在 recover）；已 durable 段保留；下一次 `append` 的 LSN 必须从 `durableLsn()+1` 继续（不得复用已丢弃的缓冲 LSN——即 crash 前未 flush 的 LSN 永久跳号）
- 行编码必须带 checksum；`recover` 遇到校验失败抛 `CorruptRecordError`
- `recover()` 返回 `{ records: {lsn,payload}[]（仅 data，升序）, lastLsn, checkpointLsn }`；无检查点时 `checkpointLsn=0`

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 记录与结果类型
- `src/codec.ts` — 行编码/解码与 checksum
- `src/segment.ts` — 内存段
- `src/group_commit.ts` — 截止判定
- `src/wal.ts` — `Wal` 门面：append/flush/tick/checkpoint/crash/recove
- `src/errors.ts` — `WalError` / `CorruptRecordError`
- `src/index.ts` — 统一导出

对外 API 以 `Wal` / `VirtualClock` / 错误类型为准（见各模块导出）。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
