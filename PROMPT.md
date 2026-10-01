请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确词袋 `ExactBag`（add / remove / has / size / clear / tokens）。请在此基础上迭代实现确定性 SimHash 近重复指纹 `SimHash`：自实现 FNV 哈希、逐位累加器、fingerprint、Hamming 距离、similarity、merge、exportAcc/fromAcc 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 Node crypto 库。具体行为以 `tests/` 为准。

对外入口见 `src/index.ts`（`ExactBag` 与 `SimHash`）。

## 已具备（基础，starter 上应已通过）

- `new ExactBag()` — `add(token, weight?)` 默认 1、`remove`、`has`、`size`、`clear`、`tokens(): string[]`（字典序）

## 待迭代：SimHash

- `new SimHash(bits: number, seed: number)` — 位宽与参数校验见测试
- 内部维护长度 `bits` 的整数累加器；`fingerprint(): number` 由其导出 32-bit unsigned 指纹
- `add(token: string, weight = 1)` — 按 token 哈希各位更新累加器；frozen 后报错
- `hamming(other)` / `similarity(other)` — 要求相同 bits 与 seed；similarity = 1 − hamming/bits
- `merge(other)` — 同参时逐位累加器相加；参数不符或 frozen 时 `SimHashError`
- `exportAcc(): number[]` / `static fromAcc(bits, seed, acc)`
- `freeze()` / `stats()` — `SimHashError` 稳定 `name`

哈希与位操作在 `hash.ts`、`bits.ts` 中实现（常量与公式由测试锁定，勿用 crypto）。

## 模块

`types.ts` · `errors.ts` · `hash.ts` · `bits.ts` · `simhash.ts` · `exact.ts` · `index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
