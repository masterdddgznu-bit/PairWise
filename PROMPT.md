请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

## 目标

实现进程内 **Epoch MVCC 存储（EpochMVCC）**：逻辑 epoch 版本链、针脚快照读、乐观写事务（写写冲突）、GC，以及针脚 TTL。禁止真实网络 / DB / `setTimeout` / `Math.random`；墙钟只来自 `VirtualClock`（用于针脚过期）。

模块文件需存在并可由 `index` 导出：`clock` / `types` / `errors` / `versions` / `pins` / `txns` / `gc` / `store` / `index`。类如何切分自定，**以不变量与 tests 为准**。

## 构造

```ts
new EpochMVCC({ clock: VirtualClock, pinTtlMs?: number | null })
```

- `pinTtlMs`：默认 `null`（针脚不自动过期）。若为数字则 `>= 1`，`pin` 时 `deadline = now + pinTtlMs`。
- 非法 → `InvalidConfigError`。
- 初始 `epoch() === 0`（尚无已提交版本时读任何 key 为 `undefined`）。

## 版本与可见性

- 每次成功 `commit`：`epoch := epoch + 1`，该事务所有写以 **新 epoch** 追加版本（值或 tombstone）。
- 在读点 `e` 上，key 的可见值 = 版本链中 `version.epoch <= e` 的最大 epoch 条目；若为 tombstone → `undefined`。
- `get(key)` 等价于 `getAt(epoch(), key)`（读最新已提交）。

## 针脚（快照）

- `pin(pinId: string): number`：钉住 **当前** `epoch()`，返回该 epoch；重复 `pinId` → `DuplicatePinError`。
- `unpin(pinId): boolean`：存在则解除并返回 `true`。
- `getPinned(pinId, key)`：按该针脚 epoch 可见性读；未知 pin → `UnknownPinError`。
- `pinEpoch(pinId)` / `pinnedIds()`（字典序）。
- `drive()`：丢弃 `deadline != null && now >= deadline` 的针脚，返回过期 `pinId[]` 字典序。

## 写事务

- `begin(txnId)`：记录 `readEpoch = epoch()`；重复 id → `DuplicateTxnError`。
- `write(txnId, key, value)` / `delete(txnId, key)`：进入写集（同 key 后者覆盖）；读己写（含 delete→undefined）；未知 txn → `UnknownTxnError`。
- `read(txnId, key)`：若写集有该 key，返回写集视图；否则 `getAt(readEpoch, key)`。
- `commit(txnId): 'ok' | 'conflict'`：
  - **写写冲突**：若写集中任 key 在全局已存在已提交版本满足 `version.epoch > readEpoch`，则 abort 写集并返回 `'conflict'`（txn 删除）。
  - 否则 `epoch++`，写入版本，txn 删除，返回 `'ok'`。
  - 空写集 commit：仍允许，`epoch` **不变**，返回 `'ok'`，txn 删除。
- `abort(txnId)`：丢弃写集；不存在 → `false`，成功 `true`。

## GC

- `gc(): number`：删除不再需要的旧版本，返回删除条数。
- 版本 `v`（epoch `e`）可删 iff 存在同 key 后继版本 `e2 > e`，且 **每一个** 存活针脚的 `pinEpoch` 满足 `pinEpoch < e || pinEpoch >= e2`（即没有针脚落在需要 `v` 的区间 `[e, e2)`）。
- 无后继的最新版本永不删。tombstone 同样按上述规则回收。
- 活跃写事务不阻碍 GC（未提交写不在版本链上）。

## 其它查询

- `epoch()` / `versionCount(key)`（该 key 版本条数）/ `hasTxn(txnId)`。

不要改 `tests/`；通过 `npm test` 与 `npm run build`。
