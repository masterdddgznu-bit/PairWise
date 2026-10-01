请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Phase King（Berman–Garay）拜占庭二进制共识** 任务：n 个进程（id `0..n-1`），最大故障数 `f`，要求 `n >= 3*f+1`。协议跑 **`f+1` 个相位**（phase = `0..f`）；第 `p` 相的国王为进程 `p % n`（本题取 `king(p) = p`，因 `p < n` 在合法配置下成立）。本 harness **不模拟拜占庭偏离**，所有进程按正确协议执行；阈值仍按经典写法。

消息（完全图，`from≠to`）：
- `{ kind:"PROPOSE"; phase: number; from: number; value: 0|1; msgId: string }`
- `{ kind:"KING"; phase: number; from: number; value: 0|1; msgId: string }`

每个进程维护：本地偏好 `pref ∈ {0,1}`、当前 `phase`、是否已对当前相发过 PROPOSE/KING、已收集的提案计数、是否已 `decided`。

语义：
1. `start(inputs: number[])`：`inputs.length === n`，每个元素为 `0` 或 `1`；非法 → `InvalidConfigError`。初始化各进程 `pref = inputs[i]`，`phase = 0`，未 decided。重复 start → `BusyError`。
2. 每一相分为两轮（由 `step`/`pump` 推进，不要求显式 round API）：
   - **提案轮**：进程向所有其它进程发送 `PROPOSE{phase, value:pref}`（每进程每相只发一次）。收到 PROPOSE 后按 value 计入。当某进程在本相已收到至少 `n-f` 条 PROPOSE（含可把自身偏好计为一次：实现时在发提案后立即把本地 `pref` 计入自己的提案袋），取多数值作为 `majority`（平票时取 `1`）；记 `mult` 为该多数的票数。
   - **国王轮**：国王进程 `king = phase` 向所有其它进程发送 `KING{phase, value: 国王当前 majority（若国王尚未凑齐则用其 pref）}`。非国王与国王在收到 KING（国王可在发出后本地采用自己的 king 值）后：若 `mult > (n/2 + f)` 则 `pref = majority`，否则 `pref = kingValue`。然后 `phase += 1`。若 `phase > f` 则 `decided = true`，决定值为最终 `pref`。
3. `step(id)`：处理队头一条消息，或在 inbox 空时若本相应发未发的 PROPOSE/KING 则发送（返回 true）；无事返回 false。
4. `pump()`：反复让所有进程 step 直到一轮完全无进展。
5. `preference(id)` / `decided(id)` / `decision(id)`（未决定为 `null`）/ `phaseOf(id)` / `inboxSize` / `kingOf(phase)` / `faultBound` / `processCount` / `reset()`。
6. 禁真实网络/DB/`setTimeout`。可注入 `VirtualClock`。

构造：`new PhaseKing({ clock, processCount=4, faultBound=1 })`。
- `processCount < 2`、`faultBound < 0`、`n < 3*f+1` → `InvalidConfigError`。

模块：`clock` / `types` / `errors` / `process` / `phaseking` / `index`。

建议文件：
- `src/clock.ts`、`src/types.ts`、`src/errors.ts`、`src/process.ts`、`src/phaseking.ts`、`src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
