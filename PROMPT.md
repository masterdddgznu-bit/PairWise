## 简述

实现进程内双缓冲：`write` 只进入 staging（同 key 后写覆盖）；staging 在空闲足够久后须经 `drive` 交换，或手动 `swap`；`take` 只从 active 按首次写入序取出。active 未排空时不得交换。

## 需求

从 `src/index.ts` 导出：`VirtualClock`、`TwinBuf`，以及错误类 `TwinBufError` 和至少 `InvalidConfigError` / `InvalidKeyError` / `CapacityError` / `SwapBlockedError`。

`VirtualClock`：`now()` / `advance(ms)`（`ms < 0` 抛错）。

```ts
new TwinBuf({
  clock,
  idleMs,
  maxStaging?: number,
})
```

- `idleMs` 整数 `>= 1`。
- `maxStaging` 默认 16、整数 `>= 1`（staging 中不同 key 数上限）。
- 非法配置抛 `InvalidConfigError`。
- 初始：staging 与 active 皆空；无 `lastWriteAt`。

`write(key, payload): { status: 'accepted' | 'updated' }`

- `key` 非空，否则 `InvalidKeyError`。
- 只写 **staging**。
- 已有该 key：覆盖 payload，更新 `lastWriteAt = now`，返回 `updated`（不改变该 key 在 staging 取出序中的位置）。
- 新 key：若不同 key 数已达 `maxStaging` → `CapacityError`；否则追加到 staging 首次写入序尾，`lastWriteAt = now`，`accepted`。
- staging 变空后 `lastWriteAt` 清除。
- `write` **不会**自动 swap。

`swap(): boolean`

- 若 active 仍有未 take 的条目 → `SwapBlockedError`。
- 若 staging 为空 → `false`（不交换，不报错）。
- 否则：staging 整表变为新的 active（保持首次写入序与 payload），staging 清空并清除 `lastWriteAt`，`true`。

`drive(): { swapped: boolean }`

- 仅当 staging 非空、已有 `lastWriteAt`、且 `now >= lastWriteAt + idleMs`，并且 active 为空：执行与成功 `swap` 相同的交换，返回 `{ swapped: true }`。
- active 非空即使 idle 已到 → `{ swapped: false }`（不抛错）。
- staging 空或未到 idle → `{ swapped: false }`。
- `write`/`take` 都不会调用这套逻辑。

`take(): { key: string; payload: unknown } | null`

- 只从 **active** 按首次写入序取队头；取走后离开系统。
- active 空 → `null`。
- `take` **不会** swap。

`cancel(key): boolean`

- 非法 key → `InvalidKeyError`。
- 只取消 **staging** 中的 key：有则删除（释放容量、从顺序去掉），`true`；若因此 staging 空则清 `lastWriteAt`。
- active 中的 key 不能 cancel → `false`。
- staging 无该 key → `false`。

查询：

- `stagingKeys(): string[]` 首次写入序。
- `activeKeys(): string[]` 当前 active 剩余，首次写入序。
- `stagingCount()` / `activeCount()`
- `peekStaging(key): unknown | undefined` 非法 key 抛错。
- `peekActive(key): unknown | undefined` 非法 key 抛错。

正确性以不变量与测试为准。

## 约束

- 仓库初始没有 `src/`，自行创建源码与模块划分；测试从 `src/index.ts` 导入导出符号。
- 不要修改 `tests/`，不要加外部依赖。
- 禁止真实网络 / DB / `setTimeout` / `Math.random`。
- 时间只来自注入的 `VirtualClock`。

## 验收

`npm test` 与 `npm run build` 全部通过。
