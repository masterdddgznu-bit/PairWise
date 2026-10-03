请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的 **层级配额（soft/hard）+ ticket 预约** 半成品。单节点、唯一 ticket、完整 commit/release 的常见路径通常正常；把「祖先 hard 联检、同一 ticketId 续约替换、TTL 恰到期、部分 commit 后剩余 reserved、drive 回收后可再 admit」组合起来会出现占额泄漏或错误拒绝。请从树路径联检与 ledger/bucket 对账出发定位，而不是只改一处表面分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止真实网络、数据库、`setTimeout`/`Math.random`；时间只通过 `VirtualClock` 推进。

## 期望语义（以 tests 为准）

构造：`new QuotaRing({ clock, nodes })`
- 每个节点：`{ id, parentId?: string | null, soft, hard }`，`0 <= soft <= hard`，id 唯一，parent 必须存在（或省略/null 表示根），无环；否则 `InvalidConfigError`。

API：
- `reserve(nodeId, amount, ttlMs, ticketId)`：在 `now + ttlMs` 前占用 `amount`。`amount >= 1`，`ttlMs >= 1`。须对 **该节点及其全部祖先** 检查：`committed + reserved + amount <= hard`。成功则沿路径增加 reserved。若 `ticketId` 已存在，先按 `release` 语义释放旧票再预约（替换）。失败返回 `{ ok: false, reason }`，成功 `{ ok: true }`。
- `commit(ticketId, used)`：`0 <= used <= ticket.remaining`。沿路径：`committed += used`，`reserved -= used`；若 remaining 归零则删票，否则缩减票额。
- `release(ticketId): boolean`：释放剩余 reserved（沿路径），删票；不存在返回 `false`。
- `drive(): string[]`：回收所有 `clock.now() >= expireAt` 的票（等价 release），返回回收的 ticketId **字典序**。
- `usage(nodeId)`：`{ committed, reserved, soft, hard, overSoft }`，`overSoft = committed + reserved > soft`。
- `canAdmit(nodeId, amount)`：不修改状态，判断能否 reserve 成功。

模块：`clock` / `types` / `errors` / `bucket` / `tree` / `ledger` / `quotaring` / `index`。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
