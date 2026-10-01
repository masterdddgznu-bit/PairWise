请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Mattern 向量时钟终止检测** 任务：n 个进程（id `0..n-1`）。**PROBE** 沿逻辑环 `i → (i+1)%n` 传递；**BASIC** 计算消息可在任意 `from≠to` 之间发送（完全图控制面），并携带发送方向量时钟副本。

消息：
- `{ kind:"BASIC"; from: number; vc: number[]; msgId: string }`
- `{ kind:"PROBE"; sum: number; black: boolean; from: number; msgId: string }`

进程状态：`active`、`black`、`delta`（整数，BASIC 发送 +1 / 接收 −1）、向量时钟 `vc`（长度 n 的非负整数数组）。

语义：
1. `start()`：全部 `active=false`、`black=false`、`delta=0`、`vc` 全 0；进程 0 的 inbox 放入 `PROBE{sum:0, black:false}`。重复 start → `BusyError`。
2. `send(from, to)`：BASIC；要求已 start、`from≠to`。执行：`vc[from][from] += 1`，`delta[from] += 1`，`black[from]=true`，向 `to` 投递 `BASIC`（`vc` 为发送方时钟的浅拷贝数组）。非法 id → `InvalidProcessError`。
3. `step(id)` 处理队头：
   - **BASIC**：对每个下标 k，`vc[id][k] = max(vc[id][k], msg.vc[k])`，然后 `vc[id][id] += 1`；`delta[id] -= 1`；`active=true`。
   - **PROBE**：仅当 `!active` 时消费；若 `active` 则不消费并返回 false。处理：令 `sum' = sum + delta[id]`，`black' = black || black[id]`，然后 `black[id]=false`。若 `id===0`：若 `sum'===0 && !black'` → `terminated=true`；否则向下一跳发**新的** `PROBE{sum:0, black:false}`（新一轮探测）。若 `id!==0`：向 `(id+1)%n` 转发 `PROBE{sum:sum', black:black'}`。
4. `localDone(id)`：`active=false`。未 start → `BusyError`。
5. `pump()`：反复 step 所有进程直到一轮无进展。注意 active 进程头顶 PROBE 时 step 返回 false，需先 localDone 再 pump。
6. `terminated()` / `deltaOf` / `vectorOf`（返回 vc 副本）/ `isActive` / `isBlack` / `hasProbe(id)`（inbox 含 PROBE）/ `nextOf(id)=(id+1)%n` / `inboxSize` / `reset()`。
7. 禁真实网络/DB/`setTimeout`。可注入 `VirtualClock`。不要求上下线。

构造：`new Mattern({ clock, processCount=4 })`，`processCount<2` → `InvalidConfigError`。

模块：`clock` / `types` / `errors` / `process` / `mattern` / `index`。

建议文件：
- `src/clock.ts`、`src/types.ts`、`src/errors.ts`、`src/process.ts`、`src/mattern.ts`、`src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
