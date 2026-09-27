请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

这是一个进程内 TTL 去重窗口任务：用 `remember` 记录键并赋予过期时刻；`seen` 判断键是否仍在窗口内；容量满时插入新键前按 **过期时刻升序**（相同则按 **插入序号 seq 升序**）驱逐；`tick`/`expireNow` 清理到期项。现有文件仅为类型与空壳，请按模块职责自行实现。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过注入的 `VirtualClock` 推进。

语义约束（测试会覆盖）：
- 构造：`new DedupTtl({ clock, ttl=10, capacity=8 })`；`ttl` 与 `capacity` 必须为正整数，否则抛 `InvalidConfigError`
- `remember(key)`：
  - `key` 为空字符串抛 `InvalidKeyError`
  - 调用前先做一次惰性过期（清除 `expireAt <= now` 的项）
  - 若 key 已存在且未过期：刷新 `expireAt = now + ttl`，**不改变 seq**，返回 `{ inserted: false, refreshed: true, evicted: null }`
  - 若 key 不存在：若 `size == capacity`，先驱逐 **一个** 最早到期项（expireAt 最小，并列取 seq 最小），记入 `evicted`；再插入新项 `expireAt = now + ttl`，分配递增 `seq`；返回 `{ inserted: true, refreshed: false, evicted }`
- `seen(key)`：先惰性过期；存在且未过期返回 true，否则 false（空 key 抛 `InvalidKeyError`）
- `forget(key)`：存在则删除返回 true，否则 false（空 key 抛 `InvalidKeyError`）
- `expireNow()`：删除所有 `expireAt <= now` 的项，返回被删 key 数组，排序规则：expireAt 升序，相同则 key 字典序
- `tick()`：`clock.advance(1)` 然后 `expireNow()`
- `size()`：当前未过期条目数（不主动扫描时也需与惰性过期后一致；测试在断言 size 前会通过 seen/remember/expire 触发清理，实现也可在 size 内惰性过期）
- `keys()`：当前未过期 key 列表，按 seq 升序

模块划分：
- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — Entry / RememberResult 等
- `src/errors.ts` — 错误类型
- `src/entry_store.ts` — key → entry
- `src/expiry_index.ts` — 按到期排序的辅助结构
- `src/evict.ts` — 容量驱逐选择
- `src/dedup_ttl.ts` — `DedupTtl` 门面
- `src/index.ts` — 统一导出

对外 API 以 `DedupTtl` / `VirtualClock` / 错误类型为准（见各模块导出）。

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
