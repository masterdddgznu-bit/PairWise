请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内乱序重排缓冲（Reorder / Sequence Buffer）任务：接收带单调序号的片段；只接受落在滑动窗口 `[expect, expect+windowSize)` 内的包；缓冲乱序到达者；每当有从 `expect` 起的连续前缀就交付；若窗口底部缺口超过 `gapTimeout`（VirtualClock），则跳过该序号并继续交付后续已缓冲的连续段。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过注入的 `VirtualClock` 推进。

语义约束（测试会覆盖）：
- 构造：`new SeqBuf({ clock, windowSize=8, gapTimeout=10, startExpect=0 })`
- `expect()`：下一个应交付的序号
- `push(seq, payload)`：
  - `seq < 0` 抛 `InvalidSeqError`
  - `seq < expect`：视为重复/过期，忽略并返回空交付列表（不抛错）
  - `seq >= expect + windowSize`：抛 `OutOfWindowError`
  - 窗口内且槽位空：写入；若该 seq 已有内容：抛 `DuplicateSeqError`（同一序号不允许改写）
  - 写入后尝试交付连续前缀；若本次写入填上了 `expect`（或交付后新 expect 处已有缓冲），持续交付
  - **首次使某个缺口成为窗口底部**（即 push 后 expect 处仍空，且缓冲中有更高序号）时，记录 `gapSince = clock.now()`（若尚未记录）
  - 返回本次新交付的 `{ seq, payload }[]`，按 seq 升序
- `tick()`：`clock.advance(1)` 后调用 `reclaimGaps()`，再尝试交付；返回本次交付列表
- `reclaimGaps()`：当 `expect` 处为空、且存在更高序号缓冲、且 `gapSince !== null` 且 `now >= gapSince + gapTimeout` 时，将 `expect` **跳过**（记入 skipped），expect+1，清除 gapSince 或按新底部缺口重记；可连续跳过多跳若下一格仍空且超时条件对同一 gapSince 仍成立——**每次只跳过一格**，由调用方多次 tick/reclaim；跳过后若下一格有数据则立即交付连续前缀
- `bufferedCount()`：窗口内已缓存未交付条数
- `skipped()`：累计被超时跳过的序号列表（升序追加）
- `deliverAll()`：仅交付当前连续前缀，不推进时钟、不跳缺口

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — Packet / Delivered 等
- `src/errors.ts` — 错误类型
- `src/window.ts` — 滑动窗口槽位
- `src/gap_tracker.ts` — 缺口起始时间
- `src/deliver.ts` — 连续前缀弹出
- `src/seq_buf.ts` — `SeqBuf` 门面
- `src/index.ts` — 统一导出

对外 API 以 `SeqBuf` / `VirtualClock` / 错误类型为准（见各模块导出）。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
