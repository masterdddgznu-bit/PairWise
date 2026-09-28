请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的 HEAD 键值存储（put / get / delete / has / keys / size）。请在此基础上迭代实现写时复制快照、`fork`、快照只读视图、`diff`、引用计数 GC 与 TTL `tick`，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库或 `setTimeout`/sleep；时间一律通过 `VirtualClock` 推进。

对外入口是 `SnapStore`（见 `src/store.ts` / `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `put(key, value)` / `get(key)` / `delete(key) -> boolean` / `has(key)` / `keys()`（字典序）/ `size()`
- 基础阶段只有可变 HEAD，无快照概念

## 待迭代功能

**版本与写时复制**
- HEAD 是当前可写视图；每次 `put`/`delete` 只复制变更键的版本节点，未改键与旧版本共享
- 内部需能追踪：哪些版本节点仍被 HEAD 或某个未 drop 的快照引用

**快照 `snapshot(opts?: { ttlMs?: number }) -> snapId`**
- 返回不透明字符串 id（推荐 `s1`/`s2`/… 递增）
- 快照是创建时 HEAD 的不可变视图；之后对 HEAD 的写入不得改变 `getAt`/`keysAt`/`sizeAt`
- `ttlMs`：到期时刻 `expireAt = now + ttlMs`；`now == expireAt` 视为到期；缺省永不过期

**只读视图**
- `getAt(snapId, key)` / `keysAt(snapId)` / `sizeAt(snapId)` / `hasAt(snapId, key)`
- 未知 `snapId` 或已 drop/GC 的 id：抛 `SnapNotFoundError`

**fork**
- `fork(snapId)`：将 HEAD 重置为该快照内容的**独立可写拷贝**（之后写 HEAD 不影响该快照，也不影响 fork 前的旧 HEAD 历史快照）
- fork 后 `keys()`/`get` 与 `keysAt(snapId)`/`getAt` 初始一致

**diff**
- `diff(a, b) -> { added: string[]; removed: string[]; changed: string[] }`
  - 比较两个快照的存活键；`added` 在 b 有 a 无；`removed` 在 a 有 b 无；`changed` 两边都有但 value 不同
  - 三个数组均字典序；a/b 均须为仍存在的 snapId

**drop / GC / tick**
- `drop(snapId) -> boolean`：存在则移除快照引用并返回 true，否则 false；然后可回收不再被 HEAD 与任何快照引用的版本节点
- `tick()`：drop 所有 `expireAt <= now` 的快照并 GC
- `stats() -> { snapshots: number; versions: number }`
  - `snapshots`：当前未 drop 的快照数
  - `versions`：仍被引用的键版本节点总数（所有 key 的存活版本对象之和；同一逻辑值被共享只计一次节点）

**约束**
- `listSnapshots() -> string[]`：当前快照 id 字典序
- 删除 HEAD 上的键不影响已拍快照中的值

## 模块划分

- `src/clock.ts` / `types.ts` / `errors.ts`
- `src/version.ts` — 版本节点与引用计数
- `src/root.ts` — HEAD / 快照根（key -> version）
- `src/gc.ts` — 回收不可达版本
- `src/diff.ts` — 快照 diff
- `src/store.ts` — `SnapStore` 门面
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
