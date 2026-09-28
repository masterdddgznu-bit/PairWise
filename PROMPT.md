请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的单线程 KV（put / get / delete / has / keys / size）。请在此基础上迭代实现 VirtualClock 驱动的独占租约、fencing token，以及带 fence 的 fenced write/delete，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock.now()` / `advance()` 推进。

对外入口是 `FencedStore`（见 `src/store.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new FencedStore()` 无参：简单内存 Map
- `put(key, value)` / `get` / `delete` -> boolean / `has` / `keys()`（字典序）/ `size()`
- 无租约、无 fence；delete 直接移除

## 待迭代功能

**构造**
- `new FencedStore(clock: VirtualClock)`：feature 模式，所有租约与 fence 语义生效
- 无参构造仅用于基础测试；feature 测试一律传入 `VirtualClock`

**Lease + fencing**
- `acquire(holderId: string, ttlMs: number): { fence: number }` — 独占租约
  - 无当前租约或已过期：签发 `fence = ++globalFence`，`expiresAt = now + ttlMs`
  - 同一 holder 且仍有效：刷新 TTL，返回**相同** fence
  - 其他 holder 占用且未过期：抛 `LeaseHeldError`
- `renew(holderId, fence, ttlMs): void` — 必须匹配当前 holder+fence 且未过期；否则 `StaleFenceError` 或 `LeaseHeldError`；将 expiry 设为 `now + ttlMs`
- `release(holderId, fence): void` — 仅匹配时清除租约；否则 `StaleFenceError`
- `currentLease(): { holderId, fence, expiresAt } | null` — 无租约或已过期返回 null
- 过期判定：`clock.now() >= expiresAt`

**Fenced writes**
- feature 模式下 `put(key, value, fence: number)` / `delete(key, fence: number)` 要求 fence 等于当前有效租约的 fence；否则 `StaleFenceError`
- 成功写入后记录 `lastWriterFence()`（最近一次成功 fenced 写的 fence）
- `get` / `has` / `keys` / `size` 不受 fence 限制（读免费）
- 基础模式仍用两参 `put` / `delete`

**Steal after expiry**
- 租约过期后，其他 holder 可 `acquire` 并获得**严格更大**的 fence
- 旧 holder 用旧 fence 做 put/delete 必须抛 `StaleFenceError`（即使未 release）

**错误**（`src/errors.ts`）
- `StaleFenceError`、`LeaseHeldError`，稳定 `name` 与 message

## 模块划分

- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — `LeaseInfo` 等
- `src/errors.ts`
- `src/lease.ts` — 租约状态机
- `src/fence.ts` — fence 校验辅助
- `src/store.ts` — `FencedStore` 门面
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
