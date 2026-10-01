请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确有序映射 `ExactMap`（set / get / delete / size / keys / clear）。请在此基础上迭代实现确定性 **Treap** `Treap`：LCG 随机优先级、BST+堆不变量、set/get/delete、split/merge、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactMap` 与 `Treap`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactMap()`
- `set(key: string, value: number)` / `get(key): number | undefined`
- `delete(key): boolean`
- `size()` / `keys(): string[]`（字典序升序）/ `clear()`

## 待迭代功能

**LCG（`rng.ts`，测试锁定）**

- 线性同余：`a = 1664525`，`c = 1013904223`，`m = 2^32`
- `LcgRng(seed)`：初态 `state = seed >>> 0`
- `next(): number` — `state = (state * a + c) >>> 0`；返回新 state
- `nextFloat(): number` — `next() / 4294967296`，区间 `[0, 1)`
- `getState(): number` / `static fromState(state): LcgRng`

**Treap**

- `new Treap(seed: number)`
- 每个节点：key string、value number、priority uint32（新 key 插入时 `rng.next()`；**更新已有 key 不得重掷 priority**）
- BST 按 key 字典序；max-heap 按 priority（parent.priority >= child.priority）
- `set(key, value)` / `get(key)` / `has(key)` / `delete(key): boolean` — 旋转恢复堆；frozen → `TreapError`
- `size()` / `keys(): string[]` 中序 / `toArray(): {key,value,priority}[]` 中序
- `split(key: string): { left: Treap, right: Treap }` — left 含 key < splitKey，right 含 key >= splitKey；**split 后 this 清空（size 0）且未 freeze**；left/right 为独立新 Treap，同 seed，rng 状态克隆自 split 前（不额外消耗 RNG）；节点 priority 保留
- `static merge(left: Treap, right: Treap): Treap` — 要求 left 全部 key < right 全部 key，否则 `TreapError`；同 seed；经典按 priority 合并
- `exportState()` / `static fromState` — `{seed, rngState, entries: {key,value,priority}[]}`；fromState 按 entries 重建（**不得**对已有节点再调 RNG）
- `freeze()` / `stats(): { seed, frozen, size }`
- `TreapError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/rng.ts` — `LcgRng`
- `src/node.ts` — treap 节点
- `src/rotate.ts` — 旋转
- `src/treap.ts` — `Treap`
- `src/exact.ts` — `ExactMap`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
