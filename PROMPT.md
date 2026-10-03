请在当前 TypeScript 仓库上完成 **Feature 迭代**：保留已可用的一致性哈希基线，补齐加权虚拟节点与单 key 迁移协议，使 `npm test` 与 `npm run build` 全部通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止真实网络 / DB / `setTimeout` / `Math.random`。

## 哈希与环（基线）

- `ringSize >= 4`。
- `hash32(s)`：FNV-1a 32-bit（导出；tests 含固定向量）。
- 点位置：`hash32(material) % ringSize`。
- `addNode(id)`（默认 weight=1）：放置 1 个点，素材为 `id`。
- `removeNode(id)`；`locate(key)` → `{ owner }`，从 `hash32(key)%ringSize` 顺时针找第一个点；同 position 多点时 nodeId 升序优先。
- 空环 `locate` → `EmptyRingError`；重复节点 → `DuplicateNodeError`。

## Feature

1. **`addNode(id, weight)`**（weight>=1）：放置 weight 个点，第 i 个素材 `` `${id}#${i}` ``（i=0..weight-1）。注意：weight=1 的 Feature 路径用 `id#0`，与基线 `addNode(id)` 仅传默认 weight、素材为 `id` 的行为不同——**无第二参/默认 weight=1 时素材仍为 `id`**；仅当显式传入 weight（含显式 `1`）时用 `#i` 规则。为降低歧义：**本仓库约定**：`addNode(id)` 与 `addNode(id, 1)` 等价，素材均为 `id`；`weight>=2` 时用 `` `${id}#${i}` `` 共 weight 个点。

2. **迁移**：`beginMove(key,to)` / `commitMove` / `abortMove`  
   - begin 后 `locate` → `{ owner: 开始时归属, migratingTo: to }`  
   - commit → sticky[key]=to，清除 migrating  
   - abort → 只清 migrating  
   - removeNode 时丢掉指向该节点的 sticky，并中止相关 moves

3. **exportState / importState** 恢复 weights、点、sticky、moves。

模块：`hash` / `types` / `errors` / `points` / `ring` / `migrate` / `migring` / `index`。
