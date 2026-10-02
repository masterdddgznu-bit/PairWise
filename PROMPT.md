请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确有序映射 `ExactMap`（set / get / delete / size / keys / clear）。请在此基础上迭代实现确定性 **Red-Black Tree** `RbTree`：红黑五规则、CLRS 插入 fixup（叔节点 recolor / 旋转）、删除 transplant + 黑高缺失 fixup、range 扫描、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactMap` 与 `RbTree`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactMap()`
- `set(key: string, value: number)` / `get(key): number | undefined`
- `delete(key): boolean`
- `size()` / `keys(): string[]`（字典序升序）/ `clear()`

## 待迭代功能

**RbTree**

- `new RbTree()`
- `set(key, value)` / `get(key)` / `has(key)` / `delete(key): boolean`
  - 插入后对红节点做 insert-fixup；删除用 transplant + delete-fixup；frozen → `RbError`
- `size()` / `blackHeight()` — 空树 blackHeight **0**；单黑根 blackHeight **1**
- `height()` — 结构高度：null→0，叶→1
- `keys(): string[]` 中序升序
- `range(lo, hi): {key,value}[]` — 闭区间 lo ≤ key ≤ hi，升序
- `exportState()` / `static fromState(state)` — 按数值 id 序列化节点（含 leftId/rightId/parentId + color）；fromState 完整重建
- `freeze()` / `stats(): { frozen, size, height, blackHeight, nodeCount, redCount, blackCount }`
- `RbError`，稳定 `name`
- 颜色枚举：`"red" | "black"`

**红黑规则（测试锁定 / 经典 CLRS）**

1. 每个节点为红或黑
2. 根为黑
3. 所有 NIL 叶视为黑（隐式 null 孩子）
4. 红节点的孩子均为黑（无连续红）
5. 任一节点到其后代 NIL 的所有路径上黑节点数相同

**插入 fixup**：新插入节点为红；遇红-红时按叔节点情形 recolor / 旋转（标准 CLRS insert-fixup）。
**删除**：transplant；双孩子用中序后继；若删黑则 delete-fixup 修复黑高缺失（CLRS）。

**导出辅助（须可实现/可测）**

- `rotateLeft(handle, node)` / `rotateRight(handle, node)` — 更新 parent/child 链接
- `insertFixup(handle, node)` / `deleteFixup(handle, x, xParent)` — fixup hook
- `allocateId(nextId)` — 分配节点 id

## 模块划分

- `src/types.ts` — RbColor, RbNodeState, RbTreeState, RbStats
- `src/errors.ts` — RbError
- `src/node.ts` — RbNode（id, key, value, color, left/right/parent）+ allocateId
- `src/rotate.ts` — rotateLeft, rotateRight
- `src/insert_fixup.ts` — insertFixup
- `src/delete_fixup.ts` — deleteFixup
- `src/tree.ts` — RbTree
- `src/exact.ts` — ExactMap
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
