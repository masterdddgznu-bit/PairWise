## 简述

实现进程内按额度片老化的信用系统：`grant` 追加带截止时间的额度片；`hold` 留置占用可用额度但不立刻扣片；`spend` 先消化留置再按 grant 序 FIFO 扣片；`drive` 结算过期片与过期留置，并在余额不足时强制释放留置。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`CreditAge`，以及错误类 `CreditAgeError` 和至少 `InvalidConfigError` / `InvalidAmountError` / `CapacityError` / `UnknownLienError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new CreditAge({
  clock,
  trancheTtlMs,
  lienTtlMs,
  maxBalance,
})
```

- `trancheTtlMs`、`lienTtlMs`、`maxBalance` 均为整数 `>= 1`；非法配置抛 `InvalidConfigError`。
- 额度片 deadline = grant 时刻 + `trancheTtlMs`；留置 deadline = hold 时刻 + `lienTtlMs`。
- 有效判定均为严格小于 deadline：`now === deadline` 已过期。

额度片按 grant 先后形成稳定 FIFO。留置按 hold 先后形成稳定 FIFO，各有递增 `lienId`（从 1 起）。

容量与可用：

- `balance()`：仍有效（`now < deadline`）额度片 amount 之和；**不做**懒清。
- `held()`：仍有效留置 remaining 之和；**不做**懒清。
- `available()`：`max(0, balance() - held())`；**不做**懒清。
- `grant` 容量以懒清后的有效余额计：`balance + amount > maxBalance` → `CapacityError`。留置占用不释放 grant 容量（片仍占余额）。

`grant(amount): { status: 'accepted' }`

- `amount` 整数 `>= 1`，否则 `InvalidAmountError`。
- 先对额度片做全量懒过期（清除已过期片，不返回给调用方）；不自动清留置。
- 若懒清后 `balance + amount > maxBalance` → `CapacityError`。
- 否则追加新片，`accepted`。

`hold(amount): { lienId: number }`

- `amount` 整数 `>= 1`，否则 `InvalidAmountError`。
- 先对额度片做全量懒过期；再丢弃已过期留置（不计返回）。
- 若 `available() < amount` → `CapacityError`（可用不足）。
- 否则创建留置，`remaining = amount`，返回新 `lienId`。

`release(lienId): boolean`

- 非法/未知 `lienId`（非正整数或从未签发）→ `UnknownLienError`。
- 若该留置仍存在（含已过期未清）则移除并返回 `true`；否则 `false`。
- **不做**全量懒清其它对象。

`spend(amount): boolean`

- `amount` 整数 `>= 1`，否则 `InvalidAmountError`。
- 先懒清过期片与过期留置。
- 若 `balance() < amount` → `false`（不修改任何片或留置）。注意：判定看有效余额，不是 `available()`；已留置额度可通过本操作转为实扣。
- 否则按下列顺序扣减，必须全部成功：
  1. **先吃留置**：按 hold FIFO，从最早有效留置的 `remaining` 扣，直到凑够 `amount` 或留置耗尽；`remaining` 到 0 的留置移除。每从留置扣下的 1 单位，同时必须从额度片 FIFO 扣 1 单位（留置转实扣）。
  2. **再吃自由额度**：若留置贡献仍不足 `amount`，差额仅从额度片 FIFO 继续扣（不再创建/修改留置）。
- 成功返回 `true`。

`drive(): { expiredTrancheAmount: number; expiredTrancheCount: number; expiredLiens: number[]; forcedReleased: number }`

处理顺序写死：

1. 清除所有已过期额度片；累计 `expiredTrancheAmount` / `expiredTrancheCount`。
2. 清除所有已过期留置；其 `lienId` 按 hold 序记入 `expiredLiens`。
3. **强制对齐**：若此时 `held() > balance()`，按 hold FIFO 强制减少/移除最早留置，直到 `held() <= balance()`；被强制扣掉的 remaining 总和为 `forcedReleased`（可跨多个留置）。

查询（均无副作用，不做懒清）：

- `balance()` / `held()` / `available()` 如上。
- `tranches(): Array<{ amount: number; deadline: number }>` 仍登记的全部片（可含过期未清），grant 序。
- `liens(): Array<{ lienId: number; remaining: number; deadline: number }>` 仍登记的全部留置（可含过期未清），hold 序。
- `size(): number` 片个数。

正确性以不变量与测试为准。宜拆成多模块协作（额度账本、留置、结算推进），不要把全部逻辑塞进单文件。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
