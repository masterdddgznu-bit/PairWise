请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的单层配置（set / get / delete / list + 全局 revision）。请在此基础上迭代实现 Layer 覆盖解析、Watch、TTL、原子事务、Snapshot/Restore、Schema 校验与 Compact，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `CfgStack`（见 `src/stack.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- 默认存在名为 `base` 的底层；`set`/`delete` 作用于当前写层（初始为 `base`）
- `set(key, value) -> revision` / `get(key) -> { value, revision } | null` / `delete(key) -> revision | null`
- `list() -> string[]`（解析后可见键，字典序）
- `currentRevision()`：每次成功变更推进
- 键不存在时 `delete` 返回 `null` 且不推进 revision

## 待迭代功能

**Layers**
- `pushLayer(name)`：在栈顶压入空层，并成为当前写层；重名抛 `LayerExistsError`
- `popLayer()`：弹出栈顶（不可弹出唯一的 `base`，否则 `LayerError`）；写层回到新的栈顶
- `setOn(layer, key, value)` / `deleteOn(layer, key)`：在指定层写入；层不存在抛 `LayerError`
- `get` / `list` 从栈顶向下解析：上层非空值覆盖下层；上层对该键的 **tombstone（删除标记）** 遮蔽下层
- `layers()`：自底向顶返回层名

**Watch**
- `watch(prefix, fromRevision) -> watchId`：订阅 key 以 prefix 开头、且 revision > fromRevision 的解析结果变化
- 事件：`{ type: 'set'|'delete', key, value, revision }`（delete 时 value 为 null）
- `pollWatch` / `unwatch`；TTL 过期与事务内变更也必须通知

**TTL**
- `setTtl(key, value, ttlMs) -> revision`：写入当前写层并设置过期点 `clock.now()+ttlMs`
- `tick()`：过期键在**当前写层**打 tombstone（推进 revision、通知 watch）；普通 `set` 清除该键 TTL

**事务 `txn(ops) -> commitRevision`**
- `ops`: `{type:'set'|'delete'|'setOn'|'deleteOn', ...}` 数组，全部成功或全部失败
- 任一层不存在 → 抛 `TxnError`，无副作用
- Schema 校验失败 → 抛 `SchemaError`，无副作用
- **成功事务只推进一次全局 revision**，事务内变更共享该 revision

**Snapshot / Restore**
- `snapshot() -> snapId`：深拷贝当前各层内容、TTL、revision（不含 watch 订阅）
- `restore(snapId)`：恢复到快照；未知 id 抛 `SnapshotError`；restore 本身不推进 revision（revision 回到快照值）；清空 watch backlog 但保留订阅的 fromRevision 游标语义以测试为准——restore 后新变更继续通知

**Schema**
- `setSchema(key, kind)`：`kind` 为 `'string'|'number'|'bool'`；之后对该 key 的写入值必须可通过校验（number/bool 用字符串形式 `"1"` / `"true"`/`"false"`）
- 校验失败抛 `SchemaError`，不写入、不推进

**Compact**
- `compact(beforeRevision)`：丢弃历史/watch backlog 中 revision **严格小于** beforeRevision 的记录，watermark=beforeRevision
- 之后 `watch(fromRevision)` 当 `fromRevision < watermark` 时抛 `CompactedError`

## 模块划分

- `src/clock.ts` — `VirtualClock`
- `src/types.ts` — 共享类型
- `src/errors.ts` — 各类 Erro
- `src/revision.ts` — 全局 revision
- `src/layers.ts` — 层栈与解析
- `src/watch.ts` — Watch
- `src/ttl.ts` — TTL
- `src/txn.ts` — 事务
- `src/snapshot.ts` — Snapshot/Restore
- `src/schema.ts` — Schema
- `src/stack.ts` — `CfgStack` 门面
- `src/index.ts` — 统一导出

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
