请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Dolev–Strong 认证广播（Authenticated Broadcast）** 教学简化版：n 个进程（id `0..n-1`），最大故障数 `f`，要求 `n >= f+2` 且 `f >= 0`。协议跑 **`f+1` 轮**（round = `1..f+1`）。本 harness **不模拟拜占庭伪造**；“签名”用确定性字符串 `sig(pid, value, round, chain)` 表示，校验只检查格式与签名者集合。

消息：
- `{ kind:"ECHO"; round: number; from: number; value: string; signers: number[]; proof: string[]; msgId: string }`
  - `signers`：已签名进程 id 的有序列表（去重、升序存储亦可，但发送时按追加顺序）
  - `proof[i]`：对应 `signers[i]` 的签名字符串

签名规则（必须一致以便测试）：
`proof` 条目 = `` `${pid}:${value}:r${round}:c${signers.slice(0,k).join(",")}` ``，其中 k 为该签名者在链中的下标+1（即签到自己为止的前缀）。

语义：
1. `start()`：清空状态，`round=1`。重复 start → `BusyError`。
2. `broadcast(value)`：仅 `sourceId` 在已 start 且尚未广播时调用；构造 `signers=[sourceId]`，`proof=[sig(source)]`，向**所有其它**进程投递 `ECHO{round:1,...}`；源本地也把该 value 记入自己的 `extracted` 候选。重复 → `BusyError`。
3. 每轮：
   - 进程收集本轮 inbox 中的 ECHO。
   - 对一条 ECHO：校验 `proof` 长度与 `signers` 一致、每个 proof 符合上述格式、`signers` 含 `sourceId`、且 `signers` 两两不同；否则丢弃。
   - 将通过校验的 `value` 加入本进程的 `extracted` 集合。
   - 若 `round <= f`：对每个**本轮新见到**的 value（此前 extracted 中未转发过的），若当前 `signers` 未含自己，则追加自己的签名形成新链，向所有其它进程发 `ECHO{round: round+1, ...}`。
   - 然后 `round += 1`。当某进程 `round` 变为 `f+2`（即已完成第 `f+1` 轮处理后）进入 decide：若 `extracted` **恰有 1 个** value 则输出它，否则输出默认值 `"⊥"`（字符串）。
4. 推进方式：`step(id)` 处理队头一条消息并可能触发转发；若 inbox 空且本轮可收尾（见实现：可用 `advanceIfQuiet`——当全局本轮消息都处理完且该进程尚未完成本轮收尾时推进 round）。为降低歧义，本题要求实现：
   - `pump()`：反复 step 所有进程；若一整轮所有 step 都无进展，则对每个尚未 decided 的进程调用内部 `endRound(id)`（把 round+1，并在 round 超过 f+1 后 decide）。
5. `decided(id)` / `decision(id)` / `extractedOf(id)`（返回 value 字符串数组的排序副本）/ `roundOf(id)` / `inboxSize` / `sourceId` / `faultBound` / `processCount` / `reset()`。
6. 禁真实网络/DB/`setTimeout`。可注入 `VirtualClock`。

导出工具：`makeSig(pid, value, round, signersPrefix: number[]): string`、`verifyEcho(msg, sourceId): boolean`。

构造：`new Dolev({ clock, processCount=4, faultBound=1, sourceId=0 })`。
- `n < f+2`、`f < 0`、`sourceId` 非法 → `InvalidConfigError`。

模块：`clock` / `types` / `errors` / `crypto` / `process` / `dolev` / `index`。

建议文件：
- `src/clock.ts`、`src/types.ts`、`src/errors.ts`、`src/crypto.ts`、`src/process.ts`、`src/dolev.ts`、`src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
