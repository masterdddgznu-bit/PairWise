请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确容量缓存 `ExactCache`（get / put / has / size / keys / clear）。请在此基础上迭代实现确定性 **CLOCK** 缓存 `ClockCache`：环形帧数组、引用位 second-chance、hand 指针、get/put/evict、peek、exportState/fromState 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器、Node crypto 库或 `Math.random`。

对外入口是 `ExactCache` 与 `ClockCache`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactCache(capacity: number)` — capacity ≥ 1，否则 `ExactError`
- `get(key): number | undefined` / `put(key, value): void` / `has(key): boolean`
- `size()` / `keys(): string[]`（**字典序升序**）/ `clear()`
- 满容时 `put` 新键逐出 **字典序最大** 键（确定性占位，非 LRU）

## 待迭代功能

**ClockCache**

- `new ClockCache(capacity: number)` — capacity ∈ [1, 4096]；否则 `ClockError`
- 帧数组长度 capacity：`{ key: string | null, value: number, ref: boolean }`，初始 key=null、ref=false
- `hand: number` 索引 0..capacity-1
- `put(key, value): void`
  - 键已存在：更新 value、ref=true，**不移动 hand**
  - 否则若有空槽（key===null）：从 hand 起顺时针找第一个空槽填入，ref=true，**hand = (slot+1) % cap**
  - 否则 evict：循环 — 若 `frames[hand].ref` 则清 ref 且 `hand=(hand+1)%cap`；否则用新键替换该帧、ref=true、`hand=(hand+1)%cap` 后 break
- `get(key): number | undefined` — 命中设 ref=true；未命中 undefined；**不移动 hand**
- `has(key)` / `size()` — 非空键计数
- `peek(key)` — 读值但不设 ref
- `frames(): {key,value,ref}[]` — 副本；空槽 `{key:null,value:0,ref:false}`
- `handPosition(): number`
- `exportState()` / `static fromState({capacity, hand, frames})`
- `freeze()` / `stats(): { capacity, frozen, size, hand }`
- `ClockError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/frame.ts` — 空帧工厂
- `src/clock.ts` — `ClockCache`
- `src/exact.ts` — `ExactCache`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
