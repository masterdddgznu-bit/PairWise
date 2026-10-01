请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确有序映射 `ExactMap`（set / get / delete / size / keys / clear）。请在此基础上迭代实现确定性 **Skip List** `SkipList`：LCG 随机层高、经典 skip list 增删查、range 扫描、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactMap` 与 `SkipList`（见 `src/index.ts`）。

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

**SkipList**

- `new SkipList(maxLevel: number, seed: number, p?: number)` — maxLevel ∈ [1, 16]；p 默认 0.5，**必须锁定 p=0.5**（用 LCG float < 0.5 判定升层）；若传入 p 且 p !== 0.5 → `SkipError`
- 新节点层高：level=1；while level < maxLevel 且 `rng.nextFloat() < 0.5`，level++
- 节点：key string、value number、各层 forward 指针
- `set(key, value)` — 已存在则更新 value（**不得**重新掷层高）；新 key 插入并随机层高；frozen → `SkipError`
- `get(key)` / `has(key)` / `delete(key): boolean` — 经典 skip delete；frozen 时 mutating 抛 `SkipError`
- `size()` / `range(minKey, maxKey): {key,value}[]` — 闭区间 minKey ≤ key ≤ maxKey，升序
- `keys(): string[]` / `toArray(): {key,value}[]`
- `exportState()` / `static fromState` — 导出 `{maxLevel, seed, rngState, entries: {key,value,level}[]}`；fromState 按 entries 中保存的 level 重建结构（**不得**对这些节点再调 RNG）；rngState 恢复供后续 insert 使用
- `freeze()` / `stats(): { maxLevel, seed, frozen, size, height }` — height 为当前实际使用的最大层高

**错误**
- `SkipError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/rng.ts` — `LcgRng`
- `src/node.ts` — skip list 节点
- `src/list.ts` — `SkipList`
- `src/exact.ts` — `ExactMap`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
