## 简述

实现进程内按 key 的暂存器：`hold` 写入或覆盖并刷新截止时间；`claim` 在预算允许且未 pin 时原子取走；pin 可阻止过期清理与认领；`drive` 只清未 pin 且已到期的 key。容量、pin 与认领预算三者联检。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`Retainer`，以及错误类 `RetainerError` 和至少 `InvalidConfigError` / `InvalidKeyError` / `CapacityError` / `PinError` / `BudgetError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new Retainer({
  clock,
  ttlMs,
  maxKeys?: number,
  initialCredits?: number,
})
```

- `ttlMs` 整数 `>= 1`。
- `maxKeys` 默认 16、整数 `>= 1`。
- `initialCredits` 默认 0、整数 `>= 0`。
- 非法配置抛 `InvalidConfigError`。

登记项：`payload`、`deadline = 最近一次成功 hold 时 now + ttlMs`、首次 hold 顺序。容量按**当前仍登记**的 key 数计（可含已过墙钟但因 pin 未清的项）。

有效未过期：`now < deadline`（`now === deadline` 视为过期）。

**联检不变量（何为对）**

- **Pin**：`pin(key)` 仅当 key 已登记；pin 期间该 key **不会**被 `drive` 清除，也**不会**被 `get`/`hold` 同 key 懒清；`claim` 遇 pin 抛 `PinError`（不消耗预算、不移除）。`unpin` 后若已过期则立刻清除并返回 `true`（表示曾 pin 且完成 unpin，清除算副作用）。
- **认领预算**：`grant(n)`（`n` 为整数 `>= 0`，否则 `InvalidConfigError` 语义上的参数错可用 `BudgetError` 或配置类错——测例以抛错且预算不变为准）增加可用额度。成功 `claim` **先**扣 1 再移除；额度不足抛 `BudgetError`，条目保持原样。`get`/`hold`/`drive`/`pin` **不**消耗预算。
- **懒过期**：仅作用于**未 pin** 的目标 key（`hold`/`get`/`claim` 触碰时）；不过期扫描其它 key。
- **`hold`**：非法空 key → `InvalidKeyError`。先对未 pin 目标做懒过期。已存在（含 pin，即便墙钟已过）：覆盖 payload、刷新 deadline，保持首次 hold 序与 pin 状态，`updated`。不存在：满容 → `CapacityError`；否则新建并入序尾，`accepted`。`hold` 不清理其它过期 key。
- **`claim`**：非法 key → `InvalidKeyError`；pin → `PinError`；预算不足 → `BudgetError`；不存在或未 pin 已过期（懒清后）→ `null` 且不扣预算；成功 → `{ payload }` 并移除（销 pin）。
- **`get`**：非法 key 抛错；未 pin 已过期 → 清除并 `undefined`；pin 且墙钟已过仍返回 payload（不清除）；否则返回 payload（不移除、不改 deadline）。
- **`drive`**：清除所有未 pin 且 `now >= deadline` 的 key，返回这些 key 按**首次 hold 序**；已 pin 即使过期也保留。
- **`cancel`**：存在则移除（含 pin），`true`；不存在 `false`。
- 查询：`keys()` / `size()` 为当前登记（可含 pin 过期未清），按首次 hold 序，**不做**全量懒清；`deadlineOf` / `isPinned` / `credits()` 无副作用；非法 key 查询类抛 `InvalidKeyError`。

宜拆成多模块协作（登记序、pin、预算等），不指定内部文件名。正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
