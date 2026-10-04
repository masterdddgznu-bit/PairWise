## 简述

实现进程内转账预扣账本：账户有余额与冻结额；发起转账时从付款方冻结金额；确认后划到收款方，取消或超时则解冻。并发 hold、部分失败与过期 fence 必须语义干净。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`WireHold`，以及错误类 `WireHoldError` 和至少 `InvalidConfigError` / `InvalidAccountError` / `InvalidWireError` / `FenceError` / `UnknownWireError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new WireHold({ clock, holdTimeoutMs, maxOpenWiresPerAccount?: number })
```

- `holdTimeoutMs >= 1`；`maxOpenWiresPerAccount` 默认 8、`>= 1`。非法配置抛 `InvalidConfigError`。

`openAccount(accountId, balance): void`

- `accountId` 非空；`balance` 为有限数且 `>= 0`。否则 `InvalidAccountError`。
- 已存在 → `InvalidAccountError`。

`balanceOf(accountId): { available: number; held: number; total: number }`

- 未知账户 `InvalidAccountError`。
- 不变量：`total === available + held`（整数运算用 number，测例只用整数）。

`wire(fromId, toId, amount): { wireId: number; fence: number }`

- 未知账户 `InvalidAccountError`。
- `fromId === toId`、`amount` 非有限或 `< 1` → `InvalidWireError`。
- 付款方当前 **open**（held/未终态）wire 数已达 `maxOpenWiresPerAccount` → `InvalidWireError`。
- `available < amount` → `InvalidWireError`（不扣）。
- 成功：`available -= amount`，`held += amount`；分配全局递增 `wireId`（从 1）；该付款方 `fence` 从 1 递增（每成功发起一笔 +1）；`deadline = now + holdTimeoutMs`；状态 `open`。

`commit(wireId, fence): boolean`

- 未知 `wireId` → `UnknownWireError`。
- 状态不是 `open` → `false`。
- `fence` 与该笔记录不一致 → `FenceError`。
- 成功：付款方 `held -= amount`；收款方 `available += amount`；状态 `committed`；`true`。

`abort(wireId, fence): boolean`

- 未知 `UnknownWireError`。
- 非 `open` → `false`。
- fence 错 → `FenceError`。
- 成功：付款方 `held -= amount`，`available += amount`；状态 `aborted`；`true`。

`drive()`：

1. 所有仍 `open` 且 `now >= deadline` 的 wire 按 abort 语义自动释放（状态 `timedout`）。
2. 返回 `{ timedOut: number[] }` 本轮超时的 `wireId` 升序。

查询：

- `statusOf(wireId): 'open' | 'committed' | 'aborted' | 'timedout'` 未知 `UnknownWireError`。
- `openWiresOf(accountId): number[]` 该账户作为 **付款方** 的 open `wireId` 升序；未知账户 `InvalidAccountError`。
- `fenceOf(wireId): number` 未知 `UnknownWireError`。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
