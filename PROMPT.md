请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确有序映射 `ExactMap`（set / get / delete / size / keys / clear）。请在此基础上迭代实现确定性 **AVL Tree** `AvlTree`：平衡因子、LL/LR/RR/RL 旋转、插入/删除再平衡、range 扫描、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactMap` 与 `AvlTree`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactMap()`
- `set(key: string, value: number)` / `get(key): number | undefined`
- `delete(key): boolean`
- `size()` / `keys(): string[]`（字典序升序）/ `clear()`

## 待迭代功能

**AvlTree**

- `new AvlTree()`
- `set(key, value)` / `get(key)` / `has(key)` / `delete(key): boolean`
  - 插入/删除后沿路径再平衡；frozen → `AvlError`
- `size()` / `height()` — 空树 height **0**；单节点 height **1**
- `keys(): string[]` 中序升序
- `range(lo, hi): {key,value}[]` — 闭区间 lo ≤ key ≤ hi，升序
- `exportState()` / `static fromState(state)` — 按数值 id 序列化节点（含 leftId/rightId）；fromState 完整重建
- `freeze()` / `stats(): { frozen, size, height, nodeCount }`
- `AvlError`，稳定 `name`

**旋转规则（测试锁定）**

平衡因子 `bf = height(left) - height(right)`，允许 bf ∈ {-1,0,1}。

插入/删除后对节点再平衡：
- 若 bf > 1（左重）：若 `balanceFactor(left) < 0` → LR（先左旋左孩子，再右旋本节点）；否则 LL（右旋本节点）
- 若 bf < -1（右重）：若 `balanceFactor(right) > 0` → RL；否则 RR（左旋本节点）

旋转后更新 height = 1 + max(hL, hR)。

双孩子删除：用右子树中序后继（最小值）替换后删除后继。

**导出辅助（须可实现/可测）**

- `heightOf(node | null): number` — null → 0
- `balanceFactor(node): number` — height(left) - height(right)
- `rotateLeft(node)` / `rotateRight(node)` — 接受 `AvlNode`，返回新子树根并更新 height

## 模块划分

- `src/types.ts` — AvlNodeState, AvlTreeState, AvlStats
- `src/errors.ts` — AvlError
- `src/node.ts` — AvlNode + allocateId
- `src/rotate.ts` — heightOf, balanceFactor, rotateLeft, rotateRight
- `src/insert_rebalance.ts` — rebalanceAfterInsert hook
- `src/delete_rebalance.ts` — rebalanceAfterDelete hook
- `src/tree.ts` — AvlTree
- `src/exact.ts` — ExactMap
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
