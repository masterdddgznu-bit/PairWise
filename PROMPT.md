请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的资源池租约（createPool / acquire / release / holders）。请在此基础上迭代实现 TTL 租约与续租、fencing token、steal、事件 Watch、批量 acquire 与 Compact，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `LeasePool`（见 `src/pool.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `createPool(name, capacity)`：创建容量为 `capacity` 的资源池；重名抛 `PoolExistsError`
- `acquire(pool, holderId) -> Lease | null`：从池中取一个空闲资源；满则返回 `null`
- `release(pool, resourceId, holderId) -> boolean`：持有者归还；非持有者或未知返回 false
- `holders(pool) -> string[]`：当前持有者 id 列表（字典序去重）
- `Lease`: `{ pool, resourceId, holderId, token, expireAt }`
  - 基础实现：`token` 恒为 `0`，`expireAt` 恒为 `null`（永不过期）

## 待迭代功能

**TTL + renew**
- `acquire(pool, holderId, opts?: { ttlMs?: number })`
- 若提供 `ttlMs`，则 `expireAt = clock.now() + ttlMs`；否则永不过期
- `renew(pool, resourceId, holderId, ttlMs) -> boolean`：仅当前持有者可续租，刷新 `expireAt`；失败返回 false
- `tick()`：回收 `expireAt !== null && expireAt <= clock.now()` 的租约，资源回到空闲，记 `expire` 事件

**Fencing token**
- 每次成功 `acquire`（含 steal 成功）为该资源签发单调递增的全局 `token`（从 1 起）
- `release(pool, resourceId, holderId, token?)`：若传入 `token` 且与当前租约 token 不符 → 返回 false 且不释放
- 不传 `token` 时仅校验 holderId（兼容基础用法）

**Steal**
- `steal(pool, resourceId, newHolderId, opts?: { ttlMs?: number }) -> Lease | null`
- 仅当资源**已被占用**时可抢占：原租约失效，新持有者获得新 token；空闲或未知资源返回 null
- 记 `steal` 事件（message 侧用 resourceId）

**Watch**
- 全局单调 `currentSeq()`；事件 `{ seq, type, pool, resourceId, holderId, at }`
- `type`: `acquire` | `release` | `expire` | `renew` | `steal`
- `watch(fromSeq) -> watchId`；`fromSeq < watermark` 抛 `CompactedError`
- `pollWatch` / `unwatch`

**batchAcquire(pool, holderId, n, opts?) -> Lease[]**
- 一次尽量取 n 个；不足则返回能取到的（可能空数组）
- 全部共享同一 opts（ttl）；每条记 `acquire` 事件

**Compact**
- `compact(beforeSeq)`：丢弃 `seq < beforeSeq` 事件，watermark=`beforeSeq`
- 之后 `watch(fromSeq)` 当 `fromSeq < beforeSeq` 抛 `CompactedError`

## 模块划分

- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 共享类型
- `src/errors.ts` — `PoolExistsError` / `CompactedError`
- `src/tokens.ts` — fencing token 计数
- `src/resources.ts` — 池内资源与占用
- `src/ttl.ts` — 过期索引
- `src/events.ts` — 事件与 Watch / Compact
- `src/pool.ts` — `LeasePool` 门面
- `src/index.ts` — 统一导出

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
