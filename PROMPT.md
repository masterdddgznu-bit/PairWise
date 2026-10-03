请从零实现当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

## 目标

实现进程内 **所有权路由（OwnRoute）**：key 经稳定哈希落到 vnode；每个 vnode 有当前 owner 与 epoch；写路径携带 owner 的 fence；vnode 可在 owner 间手移交接（propose → prepare → commit / abort）。禁止真实网络 / DB / `setTimeout` / `Math.random`。时间只来自 `VirtualClock`（用于 handoff 超时）。

## 不变量（验收以 tests 为准；模块内部分工自定）

1. **稳定哈希**：`vnodeOf(key) = fnv1a32(key) % vnodeCount`（见下方伪码；必须与测试一致）。
2. **初始归属**：构造时 `owners` 按 **id 字典序** 排列后，vnode `i` 初始 owner 为 `owners[i % owners.length]`；每个 owner 初始 `fence = 1`；每个 vnode 初始 `epoch = 1`。
3. **读写**：
   - `write(ownerId, fence, key, value)`：仅当 `ownerId` 为该 key 当前 vnode 的 **serving owner**，且 `fence ===` 该 owner 当前 fence 时成功写入；否则返回 `'not_owner'` 或 `'stale_fence'`（优先：owner 不对 → `not_owner`；owner 对但 fence 不对 → `stale_fence`）。
   - `read(key)`：返回 `{ value, ownerId, epoch }` 或 `undefined`（未写过）。
   - serving owner：稳态为 vnode.owner；若该 vnode 处于 `prepared` 移交，仍为 **from** owner（to 尚未接管）。
4. **移交**（按 vnode，一次仅一条活跃移交）：
   - `propose(vnode, toOwnerId)` → `moveId`（字符串，全局唯一即可；测试只检查返回非空且后续 API 能用）。`toOwner` 必须存在且 ≠ 当前 owner；若该 vnode 已有进行中的移交 → `HandoffError`。
   - `prepare(moveId)`：标记 `prepared`；可选：bump **from** owner 的 fence（+1），使持旧 fence 的写立刻 `stale_fence`。测试要求：**prepare 后 from 的 fence 必须 +1**。
   - `commit(moveId)`：vnode.owner ← to；vnode.epoch += 1；**to** owner fence += 1；清除移交。此后 serving 为 to。
   - `abort(moveId)`：取消移交，owner/epoch 不变；**不**要求恢复 prepare 时 bump 过的 from fence（保持 bump 后的值）。
5. **超时**：`propose(..., ttlMs)` 记录 `deadline = now + ttlMs`。`drive()`：若移交仍未 commit/abort 且 `now >= deadline`，等价 `abort`，并将该 `moveId` 纳入返回列表（字典序）。`ttlMs` 缺省 `null` 表示不超时。
6. **查询**：`ownerOf(key)` / `vnodeOf(key)` / `epochOf(vnode)` / `fenceOf(ownerId)` / `handoffOf(vnode)`（无则 `undefined`，有则 `{ moveId, from, to, phase: 'proposed'|'prepared' }`）。

## FNV-1a 32（必须一致）

```
offset = 2166136261
prime  = 16777619
h = offset
for each byte b of UTF-8(key):
  h = (h XOR b) * prime   (uint32 wrap)
vnode = h % vnodeCount
```

## API 轮廓

```ts
new OwnRoute({
  clock: VirtualClock,
  owners: string[],     // 非空、唯一
  vnodeCount: number,   // >= 1
})
```

非法配置 → `InvalidConfigError`。未知 owner/vnode/moveId → 对应 `Unknown*` / `HandoffError`。

## 模块划分（文件名需存在并可被 index 导出）

`clock` / `types` / `errors` / `hash` / `owners` / `vnodes` / `handoff` / `router` / `index`

不要改 `tests/`；需通过 `npm test` 与 `npm run build`。
