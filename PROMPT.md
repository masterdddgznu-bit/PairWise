请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Ben-Or 随机化拜占庭二进制共识**（教学简化同步版）任务：n 个进程（id `0..n-1`），最大故障数 `f`，要求 `n >= 5*f+1`（本题默认 n=6,f=1）。本 harness **不模拟拜占庭偏离**；随机性只来自注入的 `Rng`（禁止 `Math.random`）。

消息（完全图，`from≠to`）：
- `{ kind:"R"; round: number; from: number; value: 0|1; msgId: string }` — 第 1 阶段报告
- `{ kind:"P"; round: number; from: number; value: 0|1|"?"; msgId: string }` — 第 2 阶段提案（`?` 表示不确定）

每个进程维护：`est ∈ {0,1}`、当前 `round`（从 1 起）、是否已对本轮发过 R/P、收集袋、是否 `decided`。

语义：
1. `start(inputs: number[])`：长度 n，元素 0|1；设各进程 `est=inputs[i]`，`round=1`。非法 → `InvalidConfigError`。重复 start → `BusyError`。
2. 每一轮两阶段（由 `step`/`pump` 推进）：
   - **阶段 R**：每进程向其它进程发 `R{round, value:est}`（每轮一次）；把自己的 est 也计入本地 R 袋。当本轮 R 数 ≥ `n-f`：若某个 bit 的票数 ≥ `(n+f)/2`（向下取整），则记 `maj` 为该 bit 并进入阶段 P 准备发 `P{value:maj}`；否则准备发 `P{value:"?"}`。
   - **阶段 P**：发送上述 P（每轮一次）；把自己的 P 值计入本地 P 袋。当本轮 P 数 ≥ `n-f`：
     - 若某个 bit `b∈{0,1}` 的 P 票数 ≥ `f+1`：则 `est=b`；若该 bit 的 P 票数 ≥ `(n+f)/2`（向下取整）则 `decided=true` 并决定 `b`。
     - 否则（没有 bit 达到 `f+1`）：`est = rng.nextBit()`（0 或 1）。
     - 若未决定：`round += 1`，清空本轮袋，继续。
3. `step(id)`：优先消费 inbox；否则若本轮该发未发的 R/P 则发送；无事返回 false。忽略其它 round 的消息。
4. `pump()`：反复 step 直到一轮无进展。注意：若全员已 decided，应停止。
5. `estimate(id)` / `decided(id)` / `decision(id)` / `roundOf(id)` / `inboxSize` / `faultBound` / `processCount` / `reset()`。
6. 禁真实网络/DB/`setTimeout`/`Math.random`。必须使用构造注入的 `rng: Rng` 与 `clock: VirtualClock`。

`Rng` 接口：`nextBit(): 0|1`。测试可提供确定性序列实现。

构造：`new BenOr({ clock, rng, processCount=6, faultBound=1 })`。
- `processCount < 2`、`faultBound < 0`、`n < 5*f+1` → `InvalidConfigError`。

模块：`clock` / `rng` / `types` / `errors` / `process` / `benor` / `index`。

建议文件：
- `src/clock.ts`、`src/rng.ts`、`src/types.ts`、`src/errors.ts`、`src/process.ts`、`src/benor.ts`、`src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
