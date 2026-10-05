## 简述

实现进程内多租户消息管线：租户队列积压、租约持有、投递信用与追加型 WAL 必须一致协作；`deliver` 只服务「有积压 ∧ 租约有效 ∧ 有信用」的租户并公平轮转；任意成功变更都要落入 WAL，`recover` 后活状态与日志重放结果一致。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`WalPipe`、`WalPipe.fromJournal`，以及错误类 `WalPipeError` 和至少 `InvalidConfigError` / `InvalidArgError` / `CapacityError` / `FenceError` / `LeaseError` / `CreditError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new WalPipe({
  clock,
  leaseMs,
  maxTenants?: number,
  maxDepth?: number,
  initialCredits?: number,
})
```

- `leaseMs` 整数 `>= 1`。
- `maxTenants` 默认 8、整数 `>= 1`（曾成功 `enqueue` 或 `acquire` 即占用租户名额，直到该租户队列空且无租约）。
- `maxDepth` 默认 8、整数 `>= 1`（单租户队列深度上限）。
- `initialCredits` 默认 0、整数 `>= 0`（全局投递信用）。
- 非法配置 → `InvalidConfigError`。

**活状态与 WAL（双真相）**

- 成功的状态变更必须追加一条 WAL 记录；失败抛错的操作不得追加。
- `journal()` 返回当前日志的只读拷贝（按追加序）。
- `WalPipe.fromJournal(clock, opts, entries)`：用同一配置项（`leaseMs/maxTenants/maxDepth`；`initialCredits` 在重放中由日志决定，构造参数里的 `initialCredits` 应视为 0 而被忽略或仅用于空日志）从条目重放得到新实例；重放后队列、租约、信用、公平游标与原实例可观测行为一致。
- 活状态与日志不得长期分叉：对同一操作序列，`journal()` 重放实例的 `credits/depth/hasLease/peek` 等与源实例一致。

**租约**

- `acquire(tenant): { fence: number }`：租户名非空字符串。若已持有未过期租约 → `LeaseError`。若无租约且租户名额已满（见上占用规则）→ `CapacityError`。否则授予 `fence`（从 1 递增的全局 fence）、`deadline = now + leaseMs`。
- `renew(tenant, fence): boolean`：无租约或已过期未清理 → `false`；fence 不匹配 → `FenceError`；成功则刷新 `deadline = now + leaseMs`。
- `release(tenant, fence): boolean`：无租约 → `false`；fence 不匹配 → `FenceError`；成功清除租约。
- 墙钟过期不会在 `enqueue/deliver` 时自动清除租约；必须 `drive()`：清除所有 `now >= deadline` 的租约，返回 `{ expired: string[] }`（租户名按字典序）。过期后队列消息仍保留。

**队列与信用**

- `enqueue(tenant, id, payload)`：`tenant`/`id` 非空。若该租户深度已达 `maxDepth` → `CapacityError`。若为新租户且名额已满 → `CapacityError`。同租户重复 `id` → `InvalidArgError`（不覆盖）。成功入队尾。
- `grant(n)`：`n` 整数 `>= 0`，否则 `InvalidArgError`；增加全局信用。
- `credits()`：当前全局信用。
- `depth(tenant)` / `peek(tenant)`：不存在租户深度 0 / `null`；不做租约副作用。
- `tenants()`：当前占用名额的租户名，按**首次占用序**（首次成功 enqueue 或 acquire）。

**投递 `deliver(): { tenant; id; payload; fence } | null`**

- 在「队列非空 ∧ 当前持有未过期租约 ∧ `credits() >= 1`」的租户中公平轮转选出一名，出队首条，信用减 1，返回其 `tenant/id/payload` 与**当前租约 fence**。
- 无可投递租户 → `null`（不改信用、不写 WAL）。
- 公平：维护轮转游标；每次成功投递后从下一位占用序租户继续找；跳过不合格租户；不得饥饿仍合格者（长时间只打一个合格租户）。
- `deliver` **不会**过期租约；也不会因过期而丢消息。

查询：`hasLease(tenant)`、`fenceOf(tenant)`、`deadlineOf(tenant)`（无租约则 false/null；已过期未 drive 仍视为持有，直到 drive）。非法空字符串参数 → `InvalidArgError`。

正确性以不变量与测试为准。宜拆成多模块（队列、租约、信用、WAL 等），不指定内部文件名。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
