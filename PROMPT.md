## 简述

实现进程内滑动时间窗准入器：`admit` 登记事件并受窗口容量约束；当窗口已满仍试图 admit 时记入负债并拒绝，负债未清零前阻断一切新 admit；被隔离的 id 不参与计数与准入，直到显式清除。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SlideWin`，以及错误类 `SlideWinError` 和至少 `InvalidConfigError` / `InvalidIdError` / `DuplicateIdError` / `CapacityError` / `DebtBlockedError` / `QuarantineError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SlideWin({
  clock,
  windowMs,
  maxEvents,
  debtHealPerDrive?: number,
})
```

- `windowMs`、`maxEvents` 整数 `>= 1`。
- `debtHealPerDrive` 默认 1、整数 `>= 1`：每次 `drive` 在清窗之后最多治愈的负债点数。
- 非法配置抛 `InvalidConfigError`。

窗口内判定：事件时间戳 `ts` 满足 `now - ts < windowMs`（`now - ts === windowMs` 已滑出）。

隔离集合与登记表分离：隔离只是标志，不自动删除已登记事件。

`admit(id): { status: 'accepted' }`

处理顺序写死：

1. `id` 非空，否则 `InvalidIdError`。
2. 若 id 在隔离中 → `QuarantineError`（不做懒清）。
3. 若 `debt() > 0` → `DebtBlockedError`（不做懒清）。
4. 全量懒清：移除所有已滑出窗口的事件（不返回给调用方）。
5. 若 id 仍存在 → `DuplicateIdError`。
6. 若当前**非隔离且窗口内**事件数已达 `maxEvents`：`debt += 1`，抛 `CapacityError`（不登记）。
7. 否则登记，`ts = now`，追加到首次 admit 序尾，`accepted`。

说明：隔离中的已登记 id **不计入**步骤 6 的窗口内人数；查询 `count`/`inWindowIds` 同样忽略隔离 id。

`cancel(id): boolean`

- 非法 id → `InvalidIdError`。
- 先全量懒清。
- 若 id 仍在登记表则移除，`true`；否则 `false`。
- 不改变隔离标志与负债。

`quarantine(id): void`

- 非法 id → `InvalidIdError`。
- 将 id 标记为隔离（可对尚未 admit 的 id 预隔离）。重复调用为 no-op。

`clearQuarantine(id): boolean`

- 非法 id → `InvalidIdError`。
- 若原先在隔离中则清除并返回 `true`；否则 `false`。
- 不自动改登记表。

`drive(): { purged: string[]; healed: number }`

1. 移除所有已滑出窗口的事件；`purged` 为其 id 列表（首次 admit 序）。
2. `healed = min(debt, debtHealPerDrive)`，`debt -= healed`。
3. 隔离集合与窗口内事件不动（除已 purge 的登记）。

查询（**都无副作用**：不做懒清、不治愈负债、不改隔离）：

- `count(): number` 当前窗口内且**未隔离**的事件数。
- `size(): number` 仍登记的全部事件数（可含已滑出未清除；含隔离）。
- `debt(): number` 当前负债。
- `ids(): string[]` 仍登记的全部 id，首次 admit 序。
- `inWindowIds(): string[]` 窗口内且未隔离的 id，首次 admit 序。
- `admittedAt(id): number | null` 不存在 → `null`；非法 id 抛错；已滑出未清除也返回原 `ts`。
- `isQuarantined(id): boolean`；非法 id 抛错。

正确性以不变量与测试为准。宜拆成多模块（窗口成员、负债、隔离）协作。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
