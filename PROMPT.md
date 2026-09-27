请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的扁平排他锁（`acquire` / `release` / `holds`）。请在此基础上迭代实现多粒度锁模式、资源路径祖先意图锁、FIFO 等待队列、死锁检测、VirtualClock 超时，以及 `releaseAll` / `upgrade`，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `LockManager`（见 `src/manager.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `acquire(txn, resource)`：以排他模式 `X` 立即获取；若 resource 已被**其他** txn 持有则抛 `BusyError`
- `release(txn, resource) -> boolean`：释放该 txn 在 resource 上的锁；未持有返回 false
- `holds(txn, resource) -> boolean`
- 同一 txn 重复 `acquire` 同一 resource 为幂等成功
- 资源名在基础阶段视为扁平字符串（无层级语义）

## 待迭代功能

**锁模式 `LockMode`**
- `"IS" | "IX" | "S" | "SIX" | "X"`
- `acquire(txn, resource, mode?, opts?)`：`mode` 默认 `"X"`（兼容基础调用）
- 标准多粒度兼容矩阵（行=已持有，列=新请求；`✓` 兼容）：
  - IS 与 IS/IX/S/SIX 兼容，与 X 不兼容
  - IX 与 IS/IX 兼容，与 S/SIX/X 不兼容
  - S 与 IS/S 兼容，与 IX/SIX/X 不兼容
  - SIX 仅与 IS 兼容
  - X 与任何模式均不兼容
- 同一 resource 可被多个 txn 以相互兼容的模式同时持有（如多个 `S`）
- 同一 txn 已持有更强或相等覆盖时，再请求较弱/相同模式成功且不降级；请求更强模式视为升级（见 upgrade 规则）

**路径祖先意图锁**
- 资源用 `/` 分层，如 `db/t1/r1` 的祖先为 `db`、`db/t1`（无前导 `/`；单段名无祖先）
- 获取叶子模式时，必须**自上而下**自动持有祖先意图锁：
  - 请求 `S` 或 `IS`：每个祖先需要能覆盖 `IS`（IS/IX/S/SIX/X 均可覆盖）
  - 请求 `X`、`IX` 或 `SIX`：每个祖先需要能覆盖 `IX`（IX/SIX/X 可覆盖）
- 若祖先上缺少意图，则自动以所需意图模式获取；任一层冲突则整次 `acquire` 失败或按 `opts` 等待（不得留下部分祖先锁——等待中允许已获得的意图锁保留，见下）
- `release(txn, resource)` 只释放该 resource 本身；祖先意图需各自 `release` 或用 `releaseAll`

**等待与 FIFO**
- `opts.wait === true`：冲突时不抛 `BusyError`，将请求加入该 resource 的 FIFO 等待队列并返回（此时 `holds` 仍为 false）
- `opts.wait` 缺省/false：冲突抛 `BusyError`
- 其他 txn `release` / `releaseAll` 后，按 FIFO 尽量唤醒队首及随后可兼容授予的等待者；被授予后 `holds` 为 true，并自动补齐其祖先意图（若尚未持有）
- `isWaiting(txn) -> { resource, mode } | null`

**死锁**
- 进入等待前构造 waits-for：等待者 → 当前冲突持有者
- 若加边后成环，抛 `DeadlockError`，不入队

**超时**
- `opts.timeoutMs`：仅在 `wait:true` 时有效；到期时刻为 `clock.now() + timeoutMs`
- `tick()`：移除所有 `expireAt <= now` 的等待者（不授予锁）
- 精确边界：`now == expireAt` 视为到期

**upgrade / releaseAll / modeOf**
- `modeOf(txn, resource) -> LockMode | null`
- `upgrade(txn, resource, mode)`：txn 必须已持有该 resource；升级到更强模式；若与其他持有者/模式不兼容则抛 `BusyError`；升级不改变祖先意图（调用方/实现应保证祖先已覆盖；测试中升级前祖先已正确）
- 模式强度偏序（覆盖）：`IS < S`；`IS < IX`；`S < SIX`；`IX < SIX`；`SIX < X`；`S` 与 `IX` 不可比（`S→IX` 或 `IX→S` 的 upgrade 若目标与当前不可「覆盖升级」则抛 `BusyError`，除非目标是 `SIX`/`X` 且可兼容升级）
  - 允许的升级路径：IS→IX、IS→S、IS→SIX、IS→X、IX→SIX、IX→X、S→SIX、S→X、SIX→X
  - 不允许：S→IX、IX→S、以及任何降级
- `releaseAll(txn)`：释放该 txn 全部持有锁并清除其等待项，然后按各 resource FIFO 唤醒

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/compat.ts` — 兼容矩阵与覆盖/升级
- `src/hierarchy.ts` — 祖先路径
- `src/waiters.ts` — 等待队列
- `src/deadlock.ts` — waits-for 环检测
- `src/store.ts` — 持有关系
- `src/manager.ts` — `LockManager` 门面
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
