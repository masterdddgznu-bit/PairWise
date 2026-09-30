请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的简单字符串 KV `LocalCache`（put / get / delete / has / keys / size）。请在此基础上迭代实现分片世代缓存 `GenHub`：全局 generation 递增失效、eager 立即清键 vs lazy 延迟到 catchUp/get、put 带 gen 围栏拒绝 stale 写入、VirtualClock TTL reap 已全员应用的失效记录、lagging shard catch-up，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过注入的 `VirtualClock` 推进。

对外入口是 `LocalCache` 与 `GenHub`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new LocalCache()`
- `put(key, value)` / `get(key)` / `delete(key) -> boolean` / `has(key)` / `keys(): string[]`（字典序）/ `size()`

## 待迭代功能

**VirtualClock**（`src/clock.ts`）
- `now(): number` / `advance(ms: number): void`

**GenHub**
- `new GenHub(clock: VirtualClock, shardIds: string[])` — 每分片 `LocalCache` + `appliedGen`（初始 0）；重复 id 抛 `GenError`
- Hub 持有 `globalGen`（初始 0）与失效队列
- `put(shardId, key, value, gen: number): void` — `gen === globalGen` 且该分片 `appliedGen === globalGen`，否则 `StaleGenError` 并计数
- `get(shardId, key): string | undefined` — 读前对该分片 apply 待处理 lazy 失效；若键已失效则 `undefined`
- `invalidate(key: string, mode: 'eager' | 'lazy'): number` — `globalGen++`；记录 `{gen, key, mode, at: clock.now()}`；eager 立即从全部分片删键并 `appliedGen = globalGen`；lazy 保留值直到 catchUp/get apply；返回新 gen
- `catchUp(shardId): number` — apply 所有 `gen > appliedGen` 的失效；`appliedGen = globalGen`；返回 apply 条数
- `pendingCount(shardId): number` — 该分片尚未 apply 的失效条数（`gen > appliedGen`）
- `generation(): number` — 当前 `globalGen`
- `shardGen(shardId): number` — 分片 `appliedGen`
- `reap(ttlMs): number` — 丢弃 `clock.now()-at >= ttlMs` 且已在全部分片 apply 的失效记录；返回丢弃数
- `stats(): { globalGen, pendingInvs, stalePutRejections }`

**错误**
- `GenError`、`StaleGenError`（稳定 `name`）

## 模块划分

- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — `InvalidationRecord`、`HubStats` 等
- `src/errors.ts`
- `src/cache.ts` — `LocalCache`
- `src/invqueue.ts` — 失效队列与 TTL reap
- `src/hub.ts` — `GenHub`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
