请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确字符串计数器 `ExactCounter`（inc / get / keys / size / total）。请在此基础上迭代实现确定性 Space-Saving 草图 `SpaceSaving`：固定容量 heavy-hitters 计数、最小 count 替换（平局按 key 字典序）、estimate/guarantee 界、topK、按 max-estimate 重放 merge、exportEntries/fromEntries 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 crypto 库。

对外入口是 `ExactCounter` 与 `SpaceSaving`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactCounter()`
- `inc(key, n=1)` / `get(key)` / `keys(): string[]`（字典序）/ `size()` / `total()`

## 待迭代功能

**SpaceSaving**
- `new SpaceSaving(capacity: number)` — capacity >= 1 的整数，否则 `SSError`
- 内部最多 `capacity` 条 `{key, count, error}`（Metwally Space-Saving）
- `offer(key: string, count: number = 1): void`
  - count 必须为正整数，否则 `SSError`
  - key 已存在：`count += n`
  - 未满：插入 `{key, count: n, error: 0}`
  - 已满：找 **最小 count** 项（平局取 **字典序最小 key**）；替换为 `{key, count: minCount + n, error: minCount}`
- `estimate(key: string): number` — 存在则返回 count，否则 0（可能高估）
- `guarantee(key: string): number` — 存在则 `max(0, count - error)`，否则 0（下界）
- `topK(k: number): {key, count, error}[]` — 按 count 降序、key 升序取前 k 项；k >= 1
- `merge(other: SpaceSaving): void` — 要求相同 capacity；frozen 或 capacity 不符时 `SSError`
  - 合并算法（测试锁定）：取 `self` 与 `other` 全部 key 的并集，按 key 字典序；对空 sketch 依次 `offer(key, max(self.estimate(key), other.estimate(key)))`；结果写回 `self`
- `exportEntries(): {key, count, error}[]` — 按 key 升序
- `static fromEntries(capacity, entries): SpaceSaving`
- `freeze(): void` — 之后 offer/merge 抛 `SSError`；estimate/guarantee/topK/stats 仍可用
- `stats(): { capacity, size, totalOffered, frozen }`
- `totalOffered(): number` — 所有 offer 传入 count 之和

**错误**
- `SSError`，稳定 `name`

## 模块划分

- `src/types.ts` / `errors.ts`
- `src/slots.ts` — 最小项查找（平局字典序）
- `src/sketch.ts` — `SpaceSaving`
- `src/exact.ts` — `ExactCounter`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
