请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 **Naimi–Trehel 令牌互斥** 任务：n 个进程，初始进程 0 持有令牌且所有 `last` 指向 0。`request(i)` 若已持令牌则进入；否则置 requesting，向 `last` 发 REQUEST，并把 `last` 改为自己。收到 REQUEST 时：若持令牌且空闲则发 TOKEN；若自己也在请求则挂 `next`；否则转发到 `last`；最后把 `last` 改为请求者。`release` 后若有 `next` 则把令牌交给它。`setOnline` 控制谁能收发。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep。可注入 `VirtualClock`（本协议以消息队列为准）。

语义约束（测试会覆盖）：
- 构造：`new Naimi({ clock, processCount=3 })`。`processCount<2` → `InvalidConfigError`。进程 `0..n-1` 全部 online；状态 idle；`requesting=false`；`next=null`；inbox 空。初始 **仅进程 0** `token=true` 且 `last=0`；其余 `token=false` 且 `last=0`。
- `request(id)`：非法 → `InvalidProcessError`；offline → `OfflineError`；状态不是 idle → `BusyError`。若 `token===true`：`requesting=true`，状态 `held`，返回新 msgId（不发消息）。否则：`requesting=true`，状态 `waiting`；向当前 `last` 的 inbox 追加 `{ kind:"REQUEST", from:id, msgId }`；然后 `last=id`。返回 msgId。全局 msgId 递增 `"1"`,`"2"`,…。不立即处理 inbox。
- `release(id)`：非 `held` → `NotHolderError`；offline → `OfflineError`。状态 `idle`，`requesting=false`。若 `next !== null`：令 `k=next`，`next=null`，`token=false`，向 k 发 `{ kind:"TOKEN", from:id, msgId }`；否则继续持有令牌。返回新 msgId。
- `step(id)`：offline → `OfflineError`；inbox 空 → false。取队头：
  - REQUEST from `j`：
    - 若 `token && state===idle`：`token=false`，向 j 发 TOKEN；
    - 否则若 `requesting`：若 `next===null` 则 `next=j`（已有 next 则忽略重复挂接，测试不覆盖覆盖写）；
    - 否则：向当前 `last` 转发 REQUEST（from 仍为 j，新 msgId）；
    - 最后：`last=j`。返回 true。
  - TOKEN：`token=true`。若 `requesting`（状态 waiting）：状态变为 `held`。否则若 `next!==null`：把令牌立即转给 next（同 release 转发逻辑：`token=false`，清空 next，发 TOKEN）。否则保持 idle 持有。返回 true。
- `pump(to?)`：指定 to 则反复 step；否则轮转 online 直到一轮无进展。
- `stateOf(id)`：`"idle"|"waiting"|"held"`
- `hasToken(id)` / `lastOf(id)` / `nextOf(id)`（无则 `null`）/ `holder()`：本地持有令牌者 id，令牌在途则 `null`
- `isRequesting(id)` / `inboxSize(id)` / `setOnline` / `isOnline`
- 向目标投递时**仍写入** inbox（即使 offline）；`pump` 跳过 offline；对其 `request`/`release`/`step` 抛 `OfflineError`。

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 消息与状态类型
- `src/errors.ts` — 错误类型
- `src/process.ts` — 单进程状态
- `src/naimi.ts` — `Naimi` 门面
- `src/index.ts` — 统一导出

对外 API 以 `Naimi` / `VirtualClock` / 错误类型为准。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
