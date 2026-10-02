请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确有序映射 `ExactMap`（set / get / delete / size / keys / clear）。请在此基础上迭代实现确定性 **B+ Tree** `BPlusTree`：固定 order m、叶/内节点、插入分裂、删除借位/合并、range 扫描、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactMap` 与 `BPlusTree`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactMap()`
- `set(key: string, value: number)` / `get(key): number | undefined`
- `delete(key): boolean`
- `size()` / `keys(): string[]`（字典序升序）/ `clear()`

## 待迭代功能

**BPlusTree**

- `new BPlusTree(order: number)` — order `m` ∈ [3, 8]（小阶便于测试）；否则 `BPlusError`
  - `maxKeys = m - 1`；非根节点最少键数 `minKeys = ceil((m-1)/2)`；根可少于 minKeys
- 叶节点存 key→value；叶节点按 key 升序用 `next` 指针串成链表（左→右）供 range/keys
- 内节点存 separator keys + `children`（长度 = keys.length + 1）
- `set(key, value)` / `get(key)` / `has(key)` / `delete(key): boolean`
  - 插入：叶满则分裂；向上传播；内节点满同样分裂
  - **分裂规则（测试锁定）**：溢出后 keys 长度为 `maxKeys+1`；`splitAt = floor((maxKeys+1)/2)`；左半 `keys[0..splitAt-1]`，右半 `keys[splitAt..]`；**提升键 = 右半第一个键 `keys[splitAt]`**（奇数 maxKeys 时即为中间位）；叶分裂后更新 leaf 链
  - 删除：叶欠载则先向左兄弟借、再向右兄弟借、否则与兄弟合并并向上递归；内节点欠载同理
  - 借位/合并后更新祖先 separator；frozen → `BPlusError`
- `size()` / `height()` — 空树 height=1（单空叶根）；`keys(): string[]` 沿 leaf 链升序
- `range(lo, hi): {key,value}[]` — 闭区间 lo ≤ key ≤ hi，升序
- `exportState()` / `static fromState` — 确定性序列化整棵树（节点 id、叶链、内节点 children）；fromState 完整重建
- `freeze()` / `stats(): { order, frozen, size, height, leafCount }`
- `BPlusError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/node.ts` — 节点 id 分配、判别
- `src/leaf.ts` — 叶节点
- `src/internal.ts` — 内节点
- `src/split.ts` — 分裂
- `src/delete_rebalance.ts` — 删除借位/合并
- `src/tree.ts` — `BPlusTree`
- `src/exact.ts` — `ExactMap`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
