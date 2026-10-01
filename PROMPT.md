请阅读并修复当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个可运行的多租户 TTL 缓存半成品，带 generation token 与 singleflight 防击穿。简单 set/get 通常正常；当你把「TTL 边界、generation 递增与 compare-and-set、invalidate 后 stale 写入失败、租户隔离、load 并发合并、GC 与 size、export/import 恢复」组合在一起时，会出现不一致。请从过期判定、generation 计数与 singleflight 槽位出发定位，而不是只改一处显而易见的分支。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `TokenCache`（见 `src/cache.ts` / `src/index.ts`）。核心 API：

- `new TokenCache(clock: VirtualClock, opts?: { defaultTtlMs })`
- `get(tenant, key): { value, generation } | undefined` — 过期视为 miss
- `set(tenant, key, value, ttlMs?): { generation }` — 写入并 bump generation；expiry = now + ttl
- `invalidate(tenant, key)` — 移除条目；bump generation 使 stale compare/load 失败
- `compareAndSet(tenant, key, expectedGen, value, ttlMs?): boolean` — 仅当当前 generation 匹配时写入
- `load(tenant, key, loader, ttlMs?): V` — singleflight：同一 tenant+key 并发 load 只调用一次 loader
- `exportState()` / `importState(state)` — 崩溃恢复；import 后须尊重当前 clock 与 generation
- `size(tenant?)` / `gc()` / `stats(): { inflight }`

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` / `src/errors.ts` — 条目与快照类型
- `src/entry.ts` — 过期判定辅助
- `src/store.ts` — 按 tenant 隔离的存储、generation 计数与索引
- `src/singleflight.ts` — 同步 singleflight 合并
- `src/recover.ts` — 快照序列化/恢复
- `src/cache.ts` — `TokenCache` 门面
- `src/index.ts` — 统一导出

具体行为以 tests 为准。验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
