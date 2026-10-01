请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Safra 令牌终止检测** 任务：n 个进程（id `0..n-1`）。**TOKEN** 沿逻辑环 `i → (i+1)%n` 传递；**BASIC** 计算消息可在任意 `from≠to` 之间发送（完全图控制面）。

消息：
- `{ kind:"BASIC"; from: number; msgId: string }`
- `{ kind:"TOKEN"; color: "white"|"black"; count: number; from: number; msgId: string }`

进程状态：`active`、`color`（white/black）、`count`（整数）、是否持有令牌。

语义：
1. `start()`：全部 `active=false`、`color=white`、`count=0`；进程 0 持有令牌 `TOKEN{color:"white", count:0}`（已在其 inbox 或持有标志中，见实现约定：令牌以 inbox 中 TOKEN 表示，start 后立刻放进 0 的 inbox）。重复 start → `BusyError`。
2. `send(from, to)`：BASIC；要求已 start、`from≠to`；执行 `count[from]+=1`，`color[from]=black`，投递 BASIC。非法 id → `InvalidProcessError`。
3. `step(id)` 处理队头：
   - **BASIC**：`count[id]-=1`，`active=true`。
   - **TOKEN**：仅当 `!active` 时消费；若 `active` 则不消费并返回 false。处理：若本进程 black 则令牌改 black；令牌 `count += count[id]`；本进程改 white。若 `id===0`：若令牌 white 且 count===0 → `terminated=true`；否则向下一跳发**新的** white/count=0 令牌（新一轮探测）。若 `id!==0`：向 `(id+1)%n` 转发更新后的令牌。
4. `localDone(id)`：`active=false`。未 start → `BusyError`。
5. `pump()`：反复 step 所有进程直到一轮无进展。注意 active 进程头顶 TOKEN 时 step 返回 false，需先 localDone 再 pump。
6. `terminated()` / `colorOf` / `countOf` / `isActive` / `hasToken(id)`（inbox 含 TOKEN 或等价）/ `nextOf(id)=(id+1)%n` / `inboxSize` / `reset()`。
7. 禁真实网络/DB/`setTimeout`。可注入 `VirtualClock`。不要求上下线。

构造：`new Safra({ clock, processCount=4 })`，`processCount<2` → `InvalidConfigError`。

模块：`clock` / `types` / `errors` / `process` / `safra` / `index`（本题无独立 graph 文件也可，若需要可放 `src/ring.ts` 仅导出 `nextOf`）。

建议文件：
- `src/clock.ts`、`src/types.ts`、`src/errors.ts`、`src/process.ts`、`src/safra.ts`、`src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
