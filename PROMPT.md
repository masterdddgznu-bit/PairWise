请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Cole–Vishkin 有向环 3-着色** 教学简化版：n 个顶点（id `0..n-1`）排成**有向环**——顶点 i 的前驱 `pred(i)=(i-1+n)%n`，后继 `succ(i)=(i+1)%n`。禁止真实网络 / DB / `setTimeout` / `Math.random`；可注入 `VirtualClock`。

消息（发往后继，使对方得知自己的颜色）：
- `{ kind:"COLOR"; from: number; color: number; epoch: number }`

顶点状态：当前 `color: number`、`inbox`。

语义：
1. `start()`：置 `color(i)=i`，`epoch=0`，每点向后继发一条 `COLOR`；然后 `pump()`。重复 `start` → `BusyError`。未 `start` 就跑阶段方法 → `BusyError`。
2. **六色收缩（Cole–Vishkin 位差分）** `sixRound()`：
   - 若当前已 `maxColor() < 6`，返回 `false`（不再推进）。
   - 否则每个顶点 v 读取前驱颜色 `c_p`（inbox 中最新一条来自 pred 的 COLOR，或本地缓存的邻色），设 `c=color(v)`：
     - 令 `k` 为 `c` 与 `c_p` 二进制表示中**最低**的相异比特位（0-based，`(c^c_p)` 的最低置位）。
     - 令 `b = (c >> k) & 1`。
     - 新颜色 `c' = 2*k + b`。
   - 全体更新颜色，`epoch++`，向后继广播新 `COLOR`，`pump()`，返回 `true`。
3. `reduceToSix()`：反复 `sixRound()` 直到返回 `false`。结束后必须 `maxColor() <= 5` 且 `isProper()`。
4. **三色压缩** `threeRound(victim)`：`victim` 必须是 `5|4|3`，否则 `InvalidConfigError`。
   - 对每个 `color==victim` 的顶点：在 `{0,1,2}` 中选**最小**且不等于 `pred`/`succ` 当前色的颜色；其它顶点不变。
   - 更新后广播 `COLOR` 并 `pump()`。调用期间必须已完成六色收缩（否则 `BusyError`）。
5. `reduceToThree()`：依次 `threeRound(5)`、`threeRound(4)`、`threeRound(3)`。结束后 `maxColor()<=2`、`paletteSize()<=3`、`isProper()`。
6. `run()` = `start` → `reduceToSix` → `reduceToThree`。
7. 查询：`colorOf` / `colors()`（按 id 顺序）/ `predOf` / `succOf` / `isProper()`（环上相邻异色）/ `maxColor()` / `paletteSize()` / `epoch()` / `phase()`：
   - `idle`：未 start
   - `six`：已 start 且尚未完成六色
   - `three`：六色完成、三色未完成
   - `done`：三色完成
8. `step(id)`：投递该点 inbox 一条（若有）；`pump()`：直到所有 inbox 空；`inboxSize`；`reset()` 回 idle。
9. 导出位工具：`lowestDiffBit(a,b)`、`packColor(k,b)`（`=2*k+b`）、`bitAt(c,k)`。
10. 构造：`new CVColor({ clock, processCount })`。`n<3` → `InvalidConfigError`。

模块：`clock` / `types` / `errors` / `bits` / `ring` / `process` / `cvcolor` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
