请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Lamport Signed Messages（SM）** 教学简化版：指挥官 id = `commanderId`（默认 0），其余为中尉。最大故障数 `f`，要求 `n >= f+2`。本 harness **不模拟伪造签名**；签名用确定性字符串。

消息：
- `{ kind:"SM"; value: string; signers: number[]; proof: string[]; from: number; msgId: string }`

签名：`makeSig(pid, value, signersPrefix) = \`${pid}:${value}:c${signersPrefix.join(",")}\``。
`verifySm(msg, commanderId)`：`signers[0]===commanderId`、无重复签名者、`proof[i]===makeSig(signers[i], value, signers.slice(0,i+1))`。

语义：
1. `start()`：清空。重复 → `BusyError`。
2. `command(value)`：仅指挥官已 start 且未发令时；`signers=[commanderId]`，`proof=[makeSig(...)]`，向每个中尉发 SM；指挥官本地 `V={value}`。重复 → `BusyError`。
3. 中尉收到经 `verifySm` 的消息：将 `value` 加入本地集合 `V`；若 `signers.length <= f` 且自己不在 `signers` 中：追加自己签名，向所有不在新 `signers` 中的其它进程转发。
4. `step` / `pump`：处理 inbox 至静止，然后每个进程 `decide`：若 `|V|==0` 则 `"retreat"`，否则 `choice(V)` = **字典序最小** 的 value。
5. `decided` / `decision` / `valuesOf(id)`（V 的排序副本）/ `inboxSize` / `commanderId` / `faultBound` / `processCount` / `reset()`。
6. 导出 `makeSig`、`verifySm`、`choice(values: string[]): string`。
7. 禁真实网络/DB/`setTimeout`。可注入 `VirtualClock`。

构造：`new SignedMsg({ clock, processCount=4, faultBound=1, commanderId=0 })`。
- `n < f+2`、`f < 0`、`commanderId` 非法 → `InvalidConfigError`。

模块：`clock` / `types` / `errors` / `crypto` / `choice` / `process` / `signedmsg` / `index`。

建议文件：
- `src/clock.ts`、`src/types.ts`、`src/errors.ts`、`src/crypto.ts`、`src/choice.ts`、`src/process.ts`、`src/signedmsg.ts`、`src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
