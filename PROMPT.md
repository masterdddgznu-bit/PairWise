## 简述

实现进程内多副本因果键值层：各副本 `put` 产生版本点（dot）；水位决定哪些版本可见；并发可见冲突需 `resolve`；命名快照冻结当时可见视图；全部成功变更写入 WAL，并可 `fromJournal` 恢复到相同可观测状态。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`CausWat`、`CausWat.fromJournal`，以及错误类 `CausWatError` 和至少 `InvalidConfigError` / `InvalidArgError` / `CapacityError` / `ConflictError` / `StateError` / `UnknownError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new CausWat({
  clock,
  maxReplicas?: number,
  maxKeys?: number,
  maxSnaps?: number,
})
```

- `maxReplicas` 默认 8、`maxKeys` 默认 32、`maxSnaps` 默认 8；均为整数 `>= 1`。
- 非法配置 → `InvalidConfigError`。

**副本与版本点**

- `register(replica)`：非空字符串；重复注册幂等成功；超容量 → `CapacityError`。未注册副本上的写/水位操作 → `UnknownError`。
- `put(replica, key, value): { replica, n }`：为该副本分配下一个单调计数 `n`（从 1 起），在 `key` 上写入版本点 `(replica,n)`。同一副本对同一 key 的新 put 覆盖该副本在该 key 上的旧版本（跨副本仍可并发并存）。空 key/replica → `InvalidArgError`。新 key 超 `maxKeys` → `CapacityError`。
- `versions(key)`：返回该 key 上全部版本（含尚未被水位覆盖者），顺序不限但内容完整。
- `clockOf(replica)` / `watermarkOf(replica)`：分别返回该副本已分配的最大计数与水位。

**水位与可见性**

- `advanceWatermark(replica, n)`：将副本水位单调推进到 `n`；`n` 必须为整数且 `0 <= n <= clockOf(replica)`，且不得小于当前水位，否则 `InvalidArgError`。
- 版本点 `(r,n)` **被覆盖** 当且仅当 `watermarkOf(r) >= n`。
- `getVisible(key)`：只考虑被覆盖的版本；0 个 → `undefined`；1 个 → 其 value；**多个并发可见** → `ConflictError`。
- `getVisibleAny(key)`：同样只看被覆盖版本；多个时按 `replica` 字典序再按 `n` 取最小者（不抛冲突）。

**冲突解消与快照**

- `resolve(key, {replica,n})`：要求该 dot 仍存在于 key 上，然后将 key 压缩为仅保留胜者版本；否则 `ConflictError`。
- `snapshot(name)`：按 `getVisibleAny` 语义捕获当前所有 key 的可见值（跳过无可见版本的 key），记录 `at = now`；重名或满容按错误类抛出（重名 `InvalidArgError`，满容 `CapacityError`）。
- `readSnap(name, key)`：未知快照 → `UnknownError`；缺 key → `undefined`。
- `dropSnap(name): boolean`：存在则删除并返回 true。

**WAL 双真相**

- 成功变更必须追加日志；失败抛错不得追加。
- `journal()` 返回只读拷贝。
- `CausWat.fromJournal(clock, opts, entries)` 重放后，副本集、clock/watermark、versions/可见读、快照内容与源实例一致，且后续操作行为一致。

正确性以不变量与测试为准。宜拆多模块，不指定内部文件名。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
