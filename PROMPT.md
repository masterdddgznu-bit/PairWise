请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确有序映射 `ExactMap`（set / get / delete / size / keys / clear）。请在此基础上迭代实现确定性 **区间加 / 区间求和线段树** `SegTree`：固定整数下标域、经典 4n 节点容量、lazy add 传播、pushDown / pullUp、点更新、区间查询、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactMap` 与 `SegTree`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactMap()`
- `set(key: string, value: number)` / `get(key): number | undefined`
- `delete(key): boolean`
- `size()` / `keys(): string[]`（字典序升序）/ `clear()`

## 待迭代功能

**SegTree**

- `new SegTree(n: number)` — 覆盖下标闭开区间 `[0, n)`；`n ∈ [1, 256]`，否则 `SegError`
- 内部数组容量：经典 **4×n**（实现可用长度 `4*n+1` 的 1-based 堆式数组，下标 0 闲置）
- `build(values: number[])` — `values.length` 必须等于 `n`，否则 `SegError`；自叶向上建树
- `pointUpdate(i, value)` — 将位置 `i` 设为 `value`（`0 ≤ i < n`）
- `rangeAdd(l, r, delta)` — 对**闭区间** `[l, r]` 全体加 `delta`；`0 ≤ l ≤ r < n`
- `rangeSum(l, r): number` — 闭区间 `[l, r]` 求和
- `pointQuery(i): number`
- `exportState()` / `static fromState(state)` — 序列化 `tree`（求和数组）+ `lazy` + `n` + `frozen`；fromState 完整重建
- `freeze()` / `stats(): { n, frozen, nodeCount, pendingLazyCount }`
  - `nodeCount` = `4 * n`（容量）
  - `pendingLazyCount` = lazy 数组中非 0 标记个数
- `SegError`，稳定 `name`

**懒标记不变量（测试锁定）**

- 节点上的 lazy 表示「整段待加」；下钻前必须 `pushDown`；子节点更新后必须 `pullUp`
- pull 后：`tree[idx] = tree[left] + tree[right]`
- 对覆盖 `[L,R]` 的节点施加 `delta`：`tree[idx] += delta * (R - L + 1)`；`lazy[idx] += delta`
- 越界 / 非法参数 → `SegError`
- frozen 时 `build` / `pointUpdate` / `rangeAdd` → `SegError`

**导出辅助（须可实现/可测）**

- `leftChild(i)` / `rightChild(i)` / `parent(i)` — 1-based 堆下标：`parent = floor(i/2)`，`left = 2i`，`right = 2i+1`
- `midSplit(left, right)` — `floor((left+right)/2)`
- `applyLazy` / `composeLazy` / `clearLazy`
- `pushDown(arrays, idx, leftBound, rightBound)` / `pullUp(arrays, idx)`
- `buildFromLeaves(arrays, values, idx, leftBound, rightBound)`

## 模块划分

- `src/types.ts` — SegArrays, SegTreeState, SegStats
- `src/errors.ts` — SegError
- `src/index_math.ts` — leftChild / rightChild / parent / midSplit
- `src/lazy.ts` — applyLazy / composeLazy / clearLazy
- `src/push_pull.ts` — pushDown / pullUp
- `src/build.ts` — buildFromLeaves
- `src/tree.ts` — SegTree
- `src/exact.ts` — ExactMap
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
