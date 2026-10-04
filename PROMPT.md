## 简述

实现进程内世代封口袋：每个 stream 同时最多一个打开的 epoch，可向其追加记录；封口后该 epoch 只读；超时会自动封口；读取只能看到不超过可读水位的已封口内容，打开中的 epoch 默认不可读除非显式允许。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`SealEpoch`，以及错误类 `SealEpochError` 和至少 `InvalidConfigError` / `InvalidStreamError` / `InvalidAppendError` / `UnknownEpochError` / `InvalidSealError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new SealEpoch({ clock, openTimeoutMs, maxRecordsPerEpoch?: number })
```

- `openTimeoutMs >= 1`；`maxRecordsPerEpoch` 默认 64、`>= 1`。非法配置抛 `InvalidConfigError`。

`open(streamId): { epoch: number; fence: number }`

- `streamId` 非空，否则 `InvalidStreamError`。
- 若该 stream 已有 **open** epoch → `InvalidStreamError`。
- 否则打开新 epoch：该 stream 的 `epoch` 从 1 递增；`fence` 全局从 1 递增；`deadline = now + openTimeoutMs`；记录列表为空。

`append(streamId, epoch, fence, record: unknown): number`

- 未知 stream 或该 stream 当前 open epoch 不是 `(epoch, fence)` → 若 epoch 曾存在但已封口 → `InvalidAppendError`；若从未存在 → `UnknownEpochError`。
- 匹配 open epoch：追加 `record`，返回该 epoch 内从 0 递增的 `seq`。
- 记录数将超过 `maxRecordsPerEpoch` → `InvalidAppendError`（不追加）。
- fence 与 open epoch 的 epoch 匹配但 fence 错 → `InvalidAppendError`（不要用别的错误类）。

`seal(streamId, epoch, fence): boolean`

- 匹配当前 open → 封口并 `true`；封口后该 epoch 进入 sealed。
- fence/epoch 不匹配当前 open：若恰好是已封口的同一 epoch → `false`；未知 epoch → `UnknownEpochError`；其它错配 → `InvalidSealError`。

`drive()`：

1. 所有 `now >= deadline` 的 open epoch **自动封口**。
2. 返回 `{ sealed: Array<{ streamId: string; epoch: number }> }`，按 `streamId` 字典序，同 stream 按 `epoch` 升序。

可读水位：

- `advanceReadable(streamId, epoch): void`  
  将该 stream 的可读水位设为 `max(当前水位, epoch)`。`epoch >= 0`；未知/非法 `InvalidStreamError`（`streamId` 空）。水位初始为 0（表示还不能读任何 epoch）。
- `readableOf(streamId): number` 当前水位；未知 stream（从未 open）→ `InvalidStreamError`。

`read(streamId, epoch, opts?: { allowOpen?: boolean }): unknown[]`

- 未知 epoch → `UnknownEpochError`。
- 若 epoch 仍 open：仅当 `opts.allowOpen === true` 时返回当前已追加记录的浅拷贝数组；否则 `InvalidAppendError`（表示不可读）。
- 若 epoch 已 sealed：仅当 `epoch <= readableOf(streamId)` 时返回记录数组拷贝；否则 `InvalidAppendError`。
- 返回数组按追加序。

查询：

- `openOf(streamId): { epoch: number; fence: number } | undefined` 当前 open；无则 `undefined`；从未出现的 stream → `InvalidStreamError`。
- `recordsOf(streamId, epoch): number` 当前记录条数（open 或 sealed 均可）；未知 epoch `UnknownEpochError`。
- `isSealed(streamId, epoch): boolean`；未知 `UnknownEpochError`。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
