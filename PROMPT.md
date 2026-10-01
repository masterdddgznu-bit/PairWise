请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Lamport–Pease–Shostak Oral Messages（OM）** 教学简化版：指挥官 id = `commanderId`（默认 0），其余为中尉。最大故障数 `f`，要求 `n >= 3*f+1`。本 harness **不模拟拜占庭说谎**；所有进程按正确 OM 规则执行。

消息：
- `{ kind:"OM"; depth: number; path: number[]; value: string; from: number; msgId: string }`
  - `depth`：剩余递归深度（对应 OM(m) 的 m）
  - `path`：已转发过的进程 id 序列（不含接收者）；用于去重与多数票键

默认值（无人发来时）：`DEFAULT = "retreat"`。

语义：
1. `start()`：清空；重复 → `BusyError`。
2. `command(value)`：仅指挥官在已 start 且未发令时调用；向每个中尉发送 `OM{depth:f, path:[commanderId], value}`。重复 → `BusyError`。
3. 中尉 `L` 收到 `OM{depth:m, path:P, value:v}`：
   - 将 `v` 记入本地对键 `key(P)` 的收集（同一 key 只保留先到的一条即可）。
   - 若 `m > 0`：令 `P2 = P.concat([L])`，向所有**不在 P2 中**的其它进程（含指挥官以外的中尉，且不含自己）发送 `OM{depth:m-1, path:P2, value:v}`。
4. `pump()` / `step(id)`：消费 inbox 并按上式转发，直到静止。
5. 决定：对每个中尉，在消息静默后调用 `decide(id)`（也可在 `pump` 末尾自动 decide）：
   - 取指挥官直接消息：值为 path=`[commanderId]` 对应记录（若无则 DEFAULT）。
   - 对每个其它中尉 `j`，取 path 以 `[commanderId, j]` 为前缀且在 OM 递归中应对应「j 声称的指挥官命令」的收集值：本题简化为查找 key 恰好为 `[commanderId, j]` 的值（若无则 DEFAULT）。
   - 在集合 `{指挥官直接值} ∪ {每个其它中尉 j 的值}` 上取 **majority**（众数）；平票时取字典序最小的字符串。
   - 指挥官自己的 `decision` 为其 `command` 的 value。
6. `decided(id)` / `decision(id)` / `inboxSize` / `commanderId` / `faultBound` / `processCount` / `reset()`。
7. 导出 `majority(values: string[]): string`（平票字典序最小）。
8. 禁真实网络/DB/`setTimeout`。可注入 `VirtualClock`。

构造：`new OralMsg({ clock, processCount=4, faultBound=1, commanderId=0 })`。
- `n < 3f+1`、`f < 0`、`commanderId` 非法 → `InvalidConfigError`。

模块：`clock` / `types` / `errors` / `majority` / `process` / `oralmsg` / `index`。

建议文件：
- `src/clock.ts`、`src/types.ts`、`src/errors.ts`、`src/majority.ts`、`src/process.ts`、`src/oralmsg.ts`、`src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
