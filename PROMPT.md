## 简述

实现进程内按 key 合并的 pending 窗：`put` 按版本规则写入或归并；屏障世代决定哪些 entry 可被 `flush`/`drive` 刷出；`drive` 只刷出「屏障已放行且空闲满 idleMs」的 key。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`MergeWin`，以及错误类 `MergeWinError` 和至少 `InvalidConfigError` / `InvalidKeyError` / `InvalidVersionError` / `CapacityError` / `BarrierError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new MergeWin({ clock, idleMs, maxKeys?: number })
```

- `idleMs` 整数 `>= 1`；`maxKeys` 默认 16、整数 `>= 1`。非法配置抛 `InvalidConfigError`。

每条 pending 至少有：`payload`、`version`、`touchedAt`、`barrierGen`、稳定的首次 put 序。

`put(key, payload, version?: number): { status: 'accepted' | 'updated' | 'merged' | 'ignored' }`

- `key` 非空，否则 `InvalidKeyError`。
- `version` 省略视为 `0`；须为整数 `>= 0`，否则 `InvalidVersionError`。
- 版本归并不变量：
  - 无该 key：未满容则新建（`accepted`），已满 `CapacityError`；`touchedAt = now`；`barrierGen` 取当前开启屏障世代（无开启屏障则为 `0`）。
  - 入站 `version` **大于** 存量：覆盖 payload 与 version，刷新 `touchedAt`，`barrierGen` 更新为当前开启屏障世代（无则 `0`），首次 put 序不变，`updated`。
  - 入站 `version` **等于** 存量：覆盖 payload，刷新 `touchedAt`，`barrierGen` 同上更新，序不变，`merged`。
  - 入站 `version` **小于** 存量：不改 payload/version/`touchedAt`/`barrierGen`，`ignored`。
- `put` 本身不执行 flush/drive。

`cancel(key): boolean` — 非法 key 抛错；存在则移除并 `true`，否则 `false`。不受屏障约束。

屏障世代：

- `openBarrier(): number` — 若已有未关闭屏障 → `BarrierError`；否则世代从 1 起递增，记为当前开启世代并返回该值。开启期间新的 accepted/updated/merged 写入使用该世代作为 `barrierGen`。
- `closeBarrier(gen): boolean` — 仅当 `gen` 恰为当前开启世代时关闭并标记该世代已放行，返回 `true`；否则 `false`（不抛错）。
- `isBarrierOpen(): boolean` / `currentBarrier(): number`（无开启时为 `0`）。
- 刷出资格：`barrierGen === 0` 或该世代已被 `closeBarrier` 放行。未放行的 entry 不得出现在 `flush`/`drive` 结果中，并继续留在窗内。

`flush(): { items: Array<{ key: string; payload: unknown; version: number }> }`

- 按首次 put 序取出并移除**全部已放行** pending（忽略空闲时间）；未放行的保留。
- 空则 `{ items: [] }`。

`drive(): { items: Array<{ key: string; payload: unknown; version: number }> }`

- 只刷出「已放行且 `now >= touchedAt + idleMs`」的 key；子集内保持首次 put 序。
- 未到期或未放行的保留；`touchedAt` 不变。
- `put`/`cancel`/`peek` **不会**执行这套逻辑。

查询（无副作用）：

- `keys(): string[]` / `size(): number` — 当前全部 pending（含未放行），首次 put 序。
- `peek(key): unknown | undefined` / `versionOf(key): number | null` / `touchedAt(key): number | null` / `barrierGenOf(key): number | null`。
- 非法 key 抛 `InvalidKeyError`；缺失分别返回 `undefined` / `null`。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
