请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Chandy–Lamport 分布式快照** 任务：全连接进程图；每条有向边是 FIFO 通道；任意进程可发起快照——记录本地状态并向所有出边发 Marker；首次收到某入边 Marker 前，将该入边上到达的应用消息记入该通道快照；收齐所有入边 Marker 后该进程本地快照完成；全局在所有进程完成后结束。可用 `VirtualClock`（本协议可不依赖墙钟）。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。

语义约束（测试会覆盖）：
- 构造：`new ChandyL({ clock, processCount=3 })`；进程 id `0 .. n-1`；每对 `i≠j` 存在有向通道 `i→j`（FIFO 队列）
- 每进程有整数 `state`（初始 0）；`setState(id, value)` / `getState(id)`
- `send(from, to, payload: string)`：`payload` 为空抛 `InvalidPayloadError`；from/to 须合法且 from≠to；将消息追加到通道 `from→to` 队尾（**不**自动投递）
- `deliver(to)`：若进程 `to` 存在任意入边上队头消息，按规则一次只投递**一条**（选择：在有消息的入边中取 `from` id 最小者的队头——确定性）；若队头是应用消息：投递给 `to`（可忽略 payload 内容，但若 `to` 已开始快照且该入边尚未记录完，则把 payload 追加到该入边通道快照）；若队头是 Marker：见下
- Marker 处理（进程 `to` 从 `from` 收到 Marker）：
  - 若 `to` **尚未**开始快照：记录本地 `state` 快照，标记已开始，向所有出边发送 Marker，并将该入边通道快照记为**空**（关闭该入边记录）
  - 若 `to` **已经**开始：将该入边通道快照关闭（停止再记该边消息；已记录的保留）
  - 当 `to` 的所有入边都已关闭记录 → `to` 本地完成
- `startSnapshot(initiator)`：若已有未完成的全局快照则抛 `SnapshotInProgressError`；initiator 记录本地 state，向所有出边发 Marker；其所有入边进入「记录中」
- `pump(to?)`：若给 `to` 则对该进程反复 `deliver` 直到其所有入边队列皆空或本轮无进展；若不传则对所有进程轮转 `deliver` 直到全局无消息可投
- `isRecording(id, from)`：进程 id 是否仍在记录来自 from 的通道
- `channelSnapshot(id, from)`：已记录的 payload 数组（关闭后仍可读）；未开始则 `[]`
- `localDone(id)` / `globalDone()`：本地/全局是否完成
- `processSnapshot(id)`：若已记录返回当时 state，否则 `null`
- `queueSize(from, to)`：通道中尚未投递条数（含 Marker）

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息与快照类型
- `src/errors.ts` — 错误类型
- `src/channel.ts` — FIFO 通道
- `src/process.ts` — 单进程快照状态
- `src/chandyl.ts` — `ChandyL` 门面
- `src/index.ts` — 统一导出

对外 API 以 `ChandyL` / `VirtualClock` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
