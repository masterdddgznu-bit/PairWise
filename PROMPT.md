## 简述

实现进程内 vnode 所有权与键迁移层：固定数量的 vnode 环用确定性哈希把 key 映到 vnode；节点在租约（含 fence）保护下 join/leave 并重算所有权；所有权变更把受影响 key 放入迁移缓冲；成功变更写入可恢复 WAL，使 live ownership 与 journal 形成双真相并可 `fromJournal` 还原。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`VnodeOwn`、`VnodeOwn.fromJournal`，以及错误类 `VnodeOwnError` 与至少 `InvalidConfigError` / `InvalidArgError` / `CapacityError` / `LeaseError` / `FenceError` / `StateError` / `UnknownError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new VnodeOwn({
  clock,
  leaseMs,
  vnodeCount,
  maxNodes?,
  maxPending?,
  maxKeys?,
})
```

- `leaseMs`、`vnodeCount` 为整数且 `>= 1`；`vnodeCount` 还必须 `>= 4`。
- `maxNodes` 默认 8、`maxPending` 默认 32、`maxKeys` 默认 64；均为整数 `>= 1`。
- 非法配置 → `InvalidConfigError`。

**哈希与所有权**

- key → vnode 必须由稳定字符串哈希对 `vnodeCount` 取模得到（禁止 `Math.random`）；同一 key 在配置不变时 vnode 恒定。
- 在已 join 且租约仍有效的节点集合上，每个 vnode 有且仅有一个 owner（集合为空则无 owner）。
- 节点集合变化后，owner 分配必须确定性可复现；查询可用 `vnodeOf(key)` / `ownerOf(key)` / `ownerOfVnode(v)` / `joined()`。

**租约**

- `acquire(node)`：节点尚无未过期租约时发放新 fence（对该节点单调递增）并设定 `expireAt = now + leaseMs`；若租约仍有效再 acquire → `StateError`。
- `renew(node, fence)` / `release(node, fence)`：fence 不匹配 → `FenceError`；无有效租约 → `LeaseError`。
- 仍处于 joined 时 `release` → `StateError`（须先 leave）。
- `drive()`：使 `expireAt <= now` 的租约失效；若失效节点仍 joined，则强制脱离并按 leave 同类规则处理所有权与迁移；成功时追加 expire 类日志。

**成员与迁移**

- `join(node)` / `leave(node)` 需要有效租约，否则 `LeaseError`；状态不合法（已 join / 未 join 等）→ `StateError`；触达 `maxNodes` → `CapacityError`。
- 所有权变更时，已存在且落在被移动 vnode 上的 key 进入迁移缓冲（from→to）；若追加后会超过 `maxPending`，整次 join/leave/drive 强制失败且不得留下部分成员变更（亦不得写 WAL）。
- `put(key, value)`：路由到该 key 当前 owner；无 owner → `StateError`；新 key 超 `maxKeys` → `CapacityError`。若 key 正在迁移，put 仍写入（落在新 owner），并在返回值中标明 migrating。
- `get(key)`：若 key 正在迁移 → `StateError`；否则返回当前值或 `undefined`。
- `ackMigrate(key)` 清除单 key 迁移；未知迁移 → `UnknownError`。`drain()` 清除全部 pending 并返回被清除的 key 列表。
- 可查询 `pending()` / `leaseInfo(node)`。

**WAL 双真相**

- 成功变更必须追加 journal；失败抛错不得追加。
- `journal()` 返回只读拷贝。
- `VnodeOwn.fromJournal(clock, opts, entries)` 重放后，joined 集合、各 vnode owner、kv 内容、pending 迁移、租约 fence/到期与源实例可观测状态一致，且后续操作行为一致。

正确性以不变量与测试为准。宜拆多模块，不指定内部文件名。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
