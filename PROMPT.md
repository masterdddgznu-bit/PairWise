请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的基础修订版 KV（put/get/delete/list + 全局 revision）。请在此基础上迭代实现 CAS、历史读取、Watch、TTL、多键事务与 Compact 等能力，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `RevStore`（见 `src/store.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `put(key, value) -> revision`
- `get(key) -> { value, revision } | null`
- `delete(key) -> revision | null`（键不存在时返回 `null`，不推进 revision）
- `list() -> string[]`（按字典序）
- `currentRevision()`：全局单调 revision；每次成功的变更操作推进
- 内存中已在每次变更时追加历史条目（供后续功能使用）

## 待迭代功能

**CAS**
- `cas(key, expectedRevision, value) -> revision`：仅当键当前 revision 等于 `expectedRevision` 时成功写入并推进 revision；否则抛出 `CasFailedError`
- 成功的 CAS 视同 put：清除该键 TTL，通知 watch，追加历史

**历史**
- `getAt(key, revision)`：返回该键在给定 revision 时点的值（取 `<= revision` 的最近一次变更）；若当时不存在或已删除则返回 `null`
- `history(key)`：按 revision 升序返回 `{ revision, value }[]`，删除的 `value` 为 `null`
- 若请求的 `revision` 已被 Compact 丢掉（严格小于 compact watermark），`getAt` 抛出 `CompactedError`

**Watch**
- `watch(prefix, fromRevision) -> watchId`：订阅 key 以 `prefix` 开头、且 `revision > fromRevision` 的 put/delete 事件
- `pollWatch(watchId)`：拉取尚未消费的事件（先 catch-up 历史，再跟 live）；事件形如 `{ type: 'put'|'delete', key, value, revision }`，delete 时 `value` 为 `null`
- `unwatch(watchId)`：取消订阅
- TTL 过期删除、事务内变更也必须通知匹配的 watch

**TTL**
- `putTtl(key, value, ttlMs) -> revision`：写入并设置过期时刻为 `clock.now() + ttlMs`
- `tick()`：对 `clock.now() >= expireAt` 的键执行删除（推进 revision、追加历史、通知 watch）
- 普通 `put` / 成功 `cas` / `txn` 内对该键的写入应清除 TTL

**事务 `txn(ops) -> commitRevision`**
- `ops` 为 `put` / `delete` / `cas` 数组，**全部成功或全部失败**
- 任一 `cas` 与当前 revision 不匹配 → 抛出 `TxnConflictError`，不产生任何副作用（不推进 revision、不写历史、不通知 watch）
- **成功事务只推进一次全局 revision**：该次提交内所有变更共享同一个 `commitRevision`（请按此语义实现并保持与测试一致）
- 按 `ops` 数组顺序应用；watch 应能看到事务内各操作对应事件（共享同一 revision）

**Compact**
- `compact(beforeRevision)`：丢弃历史与 watch backlog 中 **严格小于** `beforeRevision` 的记录，并将 watermark 设为 `beforeRevision`
- 之后 `getAt(key, rev)` 当 `rev < beforeRevision` 时抛出 `CompactedError`；对未压缩区间的读取仍可用

## 模块划分

- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 共享类型
- `src/errors.ts` — `CasFailedError` / `CompactedError` / `TxnConflictError`
- `src/revision.ts` — 全局 revision 计数
- `src/history.ts` — 历史日志与 compact / getAt
- `src/cas.ts` — CAS
- `src/watch.ts` — Watch
- `src/ttl.ts` — TTL 索引与过期
- `src/txn.ts` — 事务
- `src/store.ts` — `RevStore` 门面（串联基础与功能）
- `src/index.ts` — 统一导出

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
