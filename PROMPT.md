请阅读并迭代当前 TypeScript 仓库中的 `src/`，使 `npm test` 与 `npm run build` 全部通过。

当前仓库已有可运行的精确字符串集合 `ExactSet`（add / has / remove / values / size）。请在此基础上迭代实现确定性 HyperLogLog `HyperLogLog`：FNV-1a 哈希分寄存器、leading-zero rho 更新、经典 HLL 估计（alpha_m + 小范围线性计数 + 可选大范围修正）、register-wise max merge、exportRegisters/fromRegisters 与 freeze，使全部测试通过。

只允许修改 `src/`；禁止修改 `tests/`；不要引入外部依赖。禁止使用真实网络、数据库、定时器或 crypto 库；哈希请用 `src/hash.ts` 内 FNV-1a 实现。

对外入口是 `ExactSet` 与 `HyperLogLog`（见 `src/index.ts`）。

## 已具备（基础，starter 上应已通过）

- `new ExactSet()`
- `add(key) -> boolean` / `has(key)` / `remove(key) -> boolean` / `values(): string[]`（字典序）/ `size()`

## 待迭代功能

**哈希 `src/hash.ts`**
- `fnv1a32(key: string): number` — 32-bit 无符号 FNV-1a

**HyperLogLog**
- `new HyperLogLog(precision: number)` — `precision`（记作 p）须在 4..16；`m = 2^p` 个寄存器；否则 `HllError`
- 寄存器：`number[]` 长度 m，初值 0
- 更新：`h = fnv1a32(key)`；`idx = h >>> (32-p)`；`w = (h << p) >>> 0`（等价于取 h 低 32-p 位）；`rho = leadingZeros32(w) + 1`，上限 `32-p+1`；`registers[idx] = max(registers[idx], rho)`
- `add(key: string): void` — frozen 时 `HllError`
- `estimate(): number` — 经典 HLL：
  - `E = alpha_m * m^2 / sum(2^{-M[j]})`
  - m=16/32/64 用已知 alpha 常数；m>=128 用 `0.7213/(1+1.079/m)`
  - 若 `E <= 2.5*m` 且 `zeros>0`：线性计数 `E = m * ln(m/zeros)`
  - 若 `E > 2^32/30`：大范围修正 `E = -2^32 * ln(1 - E/2^32)`
  - 返回 **`Math.round`** 修正后的估计值
- `merge(other: HyperLogLog): void` — 同 precision；逐寄存器取 max；precision 不符或 frozen 时 `HllError`
- `exportRegisters(): number[]` / `static fromRegisters(regs: number[]): HyperLogLog` — 由长度（2 的幂）推断 p
- `freeze(): void` / `isFrozen(): boolean` — freeze 后 add/merge 抛 `HllError`
- `zeros(): number` — 值为 0 的寄存器个数
- `stats(): { precision, m, zeros, frozen, adds }`

**错误**
- `HllError`，稳定 `name`

## 模块划分

- `src/hash.ts` / `types.ts` / `errors.ts`
- `src/rho.ts` — leading zeros 与 rho
- `src/estimate.ts` — alpha_m 与估计公式
- `src/hll.ts` — `HyperLogLog`
- `src/exact.ts` — `ExactSet`
- `src/index.ts`

验收：`npm test` 全绿，`npm run build` 通过，且未改动 `tests/`。
