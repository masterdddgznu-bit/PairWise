请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的单层 LRU 缓存（get / set / delete / size）。请在此基础上迭代实现 L2 回填、TTL、write-through 后端、失效 Watch、singleflight、批量 get 与 Compact，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `CacheTier`（见 `src/cache.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- 构造：`new CacheTier(clock?, { l1Capacity })`，默认 `l1Capacity = 2`
- `set(key, value)`：写入 L1；超容量按 LRU 逐出最久未用条目
- `get(key) -> string | null`：命中 L1 则刷新 LRU 并返回；未命中返回 null
- `delete(key) -> boolean`：删除 L1 中的键
- `size() -> number`：L1 当前条目数
- `keys() -> string[]`：L1 键，字典序

## 待迭代功能

**L2**
- `configureL2(capacity)`：启用容量为 `capacity` 的 L2（LRU）
- L1 逐出时把被逐出条目写入 L2（保留其 expireAt）；记 `evict` 事件
- `get` 未命中 L1 时查 L2：命中则 promote 回 L1（可能再次逐出），并刷新 L2 LRU

**TTL**
- `set(key, value, opts?: { ttlMs?: number })`
- `expireAt = clock.now() + ttlMs`；过期后 `get` 视为未命中并清除
- `tick()`：清理 L1/L2 中已过期条目，记 `expire` 事件

**Write-through Store**
- `attachStore(store)`，store 提供 `get/set/delete`
- `set`/`delete` 同步写/删 store
- `get`：L1/L2 未命中时读 store；命中则写入 L1 后返回

**Watch**
- 事件 `{ seq, type, key, at }`，`type`: `set` | `delete` | `expire` | `evict`
- `watch` / `pollWatch` / `unwatch`；`fromSeq < watermark` 抛 `CompactedError`

**Singleflight `getOrLoad(key, loader)`**
- 先走 `get`；未命中则 loade
- 同一 key 在 loader 执行期间的重入共享同一次加载（loader 只产生一个最终结果）
- 成功结果 `set` 进 L1（无 TTL）；失败不写缓存并抛出

**batchGet(keys)**
- 按顺序对每个 key 走完整 `get` 路径

**Compact**
- `compact(beforeSeq)` 后 `watch(fromSeq < beforeSeq)` 抛 `CompactedError`

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/lru.ts` / `ttl.ts` / `store.ts` / `flight.ts` / `events.ts`
- `src/cache.ts` — `CacheTier`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
