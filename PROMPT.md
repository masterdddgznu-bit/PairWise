请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Bracha 可靠广播（Reliable Broadcast）** 任务：n 个进程（id `0..n-1`），最大故障数 `f`，要求 `n >= 3*f+1`。消息在完全图上投递（任意 `from≠to`）。本 harness **不模拟拜占庭行为**，所有进程按正确协议执行；阈值仍按经典 Bracha 写死。

消息：
- `{ kind:"INITIAL"; from: number; value: string; msgId: string }` — 仅源进程发出
- `{ kind:"ECHO"; from: number; value: string; msgId: string }`
- `{ kind:"READY"; from: number; value: string; msgId: string }`

每个进程对**同一轮广播**（单次 `broadcast`）维护：
- 是否已发过 ECHO / READY
- 已收 ECHO / READY 的来源集合（按 value 分组计数）
- 是否已 `deliver`

语义：
1. `start()`：清空状态；未 start 时操作 → `BusyError`。重复 start → `BusyError`。
2. `broadcast(value)`：要求已 start 且尚未广播过；源进程为构造时的 `sourceId`（默认 0）。源向**所有其它**进程投递 `INITIAL{value}`（可不给自己 inbox，但源本地视为已见 INITIAL）。然后源按规则尝试发 ECHO（见下）。重复 broadcast → `BusyError`。
3. `step(id)` 处理队头一条消息并应用规则（可连锁在同一次 step 末尾检查阈值并投递新消息）：
   - 收到 **INITIAL**（且尚未因该 value 发 ECHO）：向所有其它进程广播 `ECHO{value}`，标记已 ECHO。
   - 收到 **ECHO**：计入该 `from` 对该 `value` 的 ECHO。若某 value 的 ECHO 数 ≥ `f+1` 且尚未 ECHO：向所有其它进程广播 `ECHO{value}`。若某 value 的 ECHO 数 ≥ `2*f+1` 且尚未 READY：向所有其它进程广播 `READY{value}`。
   - 收到 **READY**：计入。若某 value 的 READY 数 ≥ `f+1` 且尚未 READY：广播 `READY{value}`。若某 value 的 READY 数 ≥ `2*f+1` 且尚未 deliver：`deliver` 该 value。
4. 「向所有其它进程广播 X」= 对每个 `to≠id` 投递一条 X（`from=id`）。
5. `pump()`：反复 step 所有进程直到一轮无进展。
6. `delivered(id)`：该进程已投递则返回 value 字符串，否则 `null`。
7. `echoCount(id, value)` / `readyCount(id, value)` / `inboxSize` / `hasEchoed` / `hasReadied` / `sourceId()` / `faultBound()` / `processCount()` / `reset()`。
8. 禁真实网络/DB/`setTimeout`。可注入 `VirtualClock`。

构造：`new Bracha({ clock, processCount=4, faultBound=1, sourceId=0 })`。
- `processCount < 2`、`faultBound < 0`、`n < 3*f+1`、`sourceId` 非法 → `InvalidConfigError`。

模块：`clock` / `types` / `errors` / `process` / `bracha` / `index`。

建议文件：
- `src/clock.ts`、`src/types.ts`、`src/errors.ts`、`src/process.ts`、`src/bracha.ts`、`src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
